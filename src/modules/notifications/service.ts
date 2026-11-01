import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";
import type { NotificationChannel } from "@prisma/client";
import type { NotificationEvent, UserWithContacts } from "./types";
import { EVENT_ROUTING } from "./events";
import { renderClientMessage, renderAdminMessage } from "./templates";
import { renderEmailTemplate } from "./email-templates";
import { resolveChannelForUser, getAdapter } from "./channels/index";
import { telegramAdapter } from "./channels/telegram";
import { getModuleBotConfig } from "./module-chat-config";
import { dispatch } from "./dispatch/dispatcher";
import { resolveStaffRouting } from "./audience";
import { recordSkips } from "./skips";

export { getModuleBotConfig };

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  telegramId: true,
  vkId: true,
} as const;

/**
 * Main notification entry point.
 * Determines routing and dispatches to client and/or admin.
 */
export async function notify(event: NotificationEvent): Promise<void> {
  const routing = EVENT_ROUTING[event.type];
  if (!routing) {
    console.warn(`[Notifications] Unknown event type: ${event.type}`);
    return;
  }

  const promises: Promise<void>[] = [];

  if (routing.client && event.userId) {
    promises.push(notifyClient(event));
  }

  if (routing.admin && event.staffAudience !== "none") {
    promises.push(notifyAdmin(event));
  }

  await Promise.allSettled(promises);
}

/**
 * Send notification to the client (user who made the booking/order).
 */
async function notifyClient(event: NotificationEvent): Promise<void> {
  if (!event.userId) return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: event.userId },
      select: USER_SELECT,
    });
    if (!user) return;

    // Check user preferences
    const preference = await prisma.notificationPreference.findUnique({
      where: { userId: event.userId },
    });

    // Check if user opted out of this category
    const routing = EVENT_ROUTING[event.type];
    if (preference && routing?.category) {
      const categoryMap = {
        booking: preference.enableBooking,
        order: preference.enableOrder,
        reminder: preference.enableReminder,
      };
      if (categoryMap[routing.category] === false) {
        await logNotification({
          userId: event.userId,
          channel: "AUTO",
          eventType: event.type,
          moduleSlug: event.moduleSlug,
          entityId: event.entityId,
          recipient: "",
          message: "",
          status: "SKIPPED",
          error: "User opted out",
        });
        return;
      }
    }

    // Resolve channel
    const resolved = resolveChannelForUser(
      user as UserWithContacts,
      preference?.preferredChannel ?? "AUTO"
    );

    if (!resolved) {
      await logNotification({
        userId: event.userId,
        channel: "AUTO",
        eventType: event.type,
        moduleSlug: event.moduleSlug,
        entityId: event.entityId,
        recipient: "",
        message: "",
        status: "SKIPPED",
        error: "No contact info available",
      });
      return;
    }

    // Get adapter
    const adapter = getAdapter(resolved.channel);
    if (!adapter) return;

    // ── Email: use HTML template with dedup guard ──────────────────────────
    if (resolved.channel === "EMAIL" && adapter.sendHtml) {
      // Dedup: skip if this exact event was already emailed successfully
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          entityId: event.entityId,
          eventType: event.type,
          channel: "EMAIL",
          status: "SENT",
        },
      });
      if (alreadySent) return;

      const emailTemplate = renderEmailTemplate(
        event.moduleSlug,
        event.type,
        event.data
      );

      if (emailTemplate) {
        const result = await adapter.sendHtml(
          resolved.recipient,
          emailTemplate.subject,
          emailTemplate.html,
          emailTemplate.text
        );
        await logNotification({
          userId: event.userId,
          channel: resolved.channel,
          eventType: event.type,
          moduleSlug: event.moduleSlug,
          entityId: event.entityId,
          recipient: resolved.recipient,
          message: emailTemplate.text,
          status: result.success ? "SENT" : "FAILED",
          error: result.error,
        });
        return;
      }
      // No HTML template → fall through to plain-text path
    }

    // ── Plain text (Telegram, WhatsApp, etc.) ─────────────────────────────
    const message = renderClientMessage(
      event.moduleSlug,
      event.type,
      event.data
    );
    if (!message) return;

    // Get per-module bot token for Telegram
    let botToken: string | undefined;
    if (resolved.channel === "TELEGRAM") {
      const config = await getModuleBotConfig(event.moduleSlug);
      botToken = config.telegramBotToken;
    }

    const result = await adapter.send(resolved.recipient, message, { botToken });

    await logNotification({
      userId: event.userId,
      channel: resolved.channel,
      eventType: event.type,
      moduleSlug: event.moduleSlug,
      entityId: event.entityId,
      recipient: resolved.recipient,
      message,
      status: result.success ? "SENT" : "FAILED",
      error: result.error,
    });
  } catch (err) {
    console.error("[Notifications] Client notification failed:", err);
  }
}

const BOOKING_MODULES = new Set(["gazebos", "ps-park"]);

/**
 * Бронь, о которой событие: сама бронь для `booking.*` беседок и PS Park,
 * предмет платежа для `payment.*` по брони.
 */
function bookingIdForEvent(event: NotificationEvent): string | null {
  if (event.type.startsWith("booking.") && BOOKING_MODULES.has(event.moduleSlug)) {
    return event.entityId;
  }
  if (
    event.type.startsWith("payment.") &&
    event.data.subjectType === "BOOKING" &&
    typeof event.data.subjectId === "string"
  ) {
    return event.data.subjectId;
  }
  return null;
}

/**
 * Дополняет данные события тем, что нужно тексту админ-чата, но не передаётся
 * из мест вызова: имя и телефон клиента, ссылка на бронь, ресурс и слот для
 * платежа по брони, кто инициировал отмену. Раньше шаблон ждал `userName`,
 * которого не передавало ни одно место вызова, — и в чат уходило пустое
 * «Клиент:». Явно переданные поля важнее загруженных; ошибка чтения не
 * блокирует уведомление — текст просто выйдет без строки клиента.
 */
async function withAdminContext(event: NotificationEvent): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { ...event.data };
  if (data.cancelledBy === undefined && event.actor) data.cancelledBy = event.actor;

  try {
    const bookingId = bookingIdForEvent(event);
    if (bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          status: true,
          resourceId: true,
          date: true,
          startTime: true,
          endTime: true,
          clientName: true,
          clientPhone: true,
          user: { select: { name: true, phone: true } },
        },
      });
      if (!booking) return data;

      data.bookingId ??= bookingId;
      data.bookingStatus ??= booking.status;
      data.clientName ||= booking.clientName || booking.user?.name || undefined;
      data.clientPhone ||= booking.clientPhone || booking.user?.phone || undefined;
      // Платёж несёт только сумму и описание — ресурс и слот берём из брони.
      if (!data.resourceName) {
        const resource = await prisma.resource.findUnique({
          where: { id: booking.resourceId },
          select: { name: true },
        });
        data.resourceName = resource?.name;
        data.date = booking.date.toISOString().split("T")[0];
        data.startTime = formatTime(booking.startTime);
        data.endTime = formatTime(booking.endTime);
      }
      return data;
    }

    // Заказу кафе достаточно имени: телефон кухне не нужен, лишний раз его
    // в чат и журнал уведомлений не тащим.
    if (event.type.startsWith("order.") && event.userId && !data.clientName) {
      const user = await prisma.user.findUnique({
        where: { id: event.userId },
        select: { name: true },
      });
      data.clientName = user?.name || undefined;
    }
  } catch (err) {
    console.error("[Notifications] Admin context lookup failed:", err);
  }
  return data;
}

/**
 * Send notification to module staff.
 *
 * Recipients come from the single resolver (`resolveStaffRouting`,
 * ADR 2026-10-25-team-access-notifications §Q7) — the same function the
 * screens use, so «what the screen says» = «who gets it»:
 * - personal subscription (Mini App Center / staff page toggle),
 * - the module recipient list (ModuleNotificationRecipient),
 * each gated by current access; an explicit opt-out beats every path and is
 * recorded as a delivery skip. One message per person.
 *
 * Group chat — unchanged legacy behaviour: sent when the module recipient list
 * is empty (module chat, else the global admin chat), never when
 * `Module.config.telegramAdminChatEnabled === false`.
 *
 * `event.staffAudience === "personal"` → only explicit personal subscribers,
 * no list, no group chat (`"none"` never reaches notifyAdmin at all).
 */
async function notifyAdmin(event: NotificationEvent): Promise<void> {
  try {
    const data = await withAdminContext(event);
    const message = renderAdminMessage(event.moduleSlug, event.type, data);
    if (!message) return;

    const routing = await resolveStaffRouting({
      eventType: event.type,
      moduleSlug: event.moduleSlug,
      staffAudience: event.staffAudience === "personal" ? "personal" : undefined,
      withGroupChat: true,
    });

    await recordSkips(
      routing.suppressed.map(({ userId }) => ({
        userId,
        eventType: event.type,
        entityType: event.moduleSlug,
        entityId: event.entityId,
        reason: "OPTED_OUT" as const,
      }))
    );

    if (routing.recipients.length > 0) {
      const eventLabel = event.type.replace(".", " ");
      const payload = { title: `[${event.moduleSlug}] ${eventLabel}`, body: message };
      await Promise.allSettled(
        routing.recipients.map(({ userId }) =>
          dispatch({
            userId,
            eventType: event.type,
            entityType: event.moduleSlug,
            entityId: event.entityId,
            payload,
          })
        )
      );
    }

    const chat = routing.groupChat;
    if (!chat.send || !chat.chatId) {
      if (chat.reason === "no_chat_configured" && routing.recipients.length === 0) {
        console.warn(`[Notifications] No admin chat configured for module: ${event.moduleSlug}`);
      }
      return;
    }

    const result = await telegramAdapter.send(chat.chatId, message, { botToken: chat.botToken });
    await logNotification({
      userId: null,
      channel: "TELEGRAM",
      eventType: event.type,
      moduleSlug: event.moduleSlug,
      entityId: event.entityId,
      recipient: chat.chatId,
      message,
      status: result.success ? "SENT" : "FAILED",
      error: result.error,
    });
  } catch (err) {
    console.error("[Notifications] Admin notification failed:", err);
  }
}

/**
 * Get notification preferences for a user.
 * Returns default preferences if none are set.
 */
export async function getUserPreferences(userId: string) {
  const preference = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true, telegramId: true, vkId: true },
  });

  const availableChannels = [
    { channel: "TELEGRAM" as const, connected: !!user?.telegramId },
    { channel: "EMAIL" as const, connected: !!user?.email },
    { channel: "VK" as const, connected: !!user?.vkId },
  ];

  return {
    preferences: preference
      ? {
          enableBooking: preference.enableBooking,
          enableOrder: preference.enableOrder,
          enableReminder: preference.enableReminder,
          preferredChannel: preference.preferredChannel,
        }
      : {
          enableBooking: true,
          enableOrder: true,
          enableReminder: true,
          preferredChannel: "AUTO" as const,
        },
    availableChannels,
  };
}

/**
 * Update notification preferences for a user.
 */
export async function updateUserPreferences(
  userId: string,
  data: {
    enableBooking?: boolean;
    enableOrder?: boolean;
    enableReminder?: boolean;
    preferredChannel?: NotificationChannel;
  }
) {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/**
 * Log a notification attempt to the database.
 */
async function logNotification(params: {
  userId: string | null;
  channel: string;
  eventType: string;
  moduleSlug: string;
  entityId: string;
  recipient: string;
  message: string;
  status: string;
  error?: string;
}): Promise<void> {
  try {
    await prisma.notificationLog.create({
      data: {
        userId: params.userId,
        channel: params.channel as never,
        eventType: params.eventType,
        moduleSlug: params.moduleSlug,
        entityId: params.entityId,
        recipient: params.recipient,
        message: params.message,
        status: params.status as never,
        error: params.error,
        sentAt: params.status === "SENT" ? new Date() : null,
      },
    });
  } catch (err) {
    console.error("[Notifications] Failed to log notification:", err);
  }
}
