import { prisma } from "@/lib/db";
import type { NotificationChannel } from "@prisma/client";
import type { NotificationEvent, ModuleBotConfig, UserWithContacts } from "./types";
import { EVENT_ROUTING } from "./events";
import { renderClientMessage, renderAdminMessage } from "./templates";
import { renderEmailTemplate } from "./email-templates";
import { resolveChannelForUser, getAdapter } from "./channels/index";
import { telegramAdapter } from "./channels/telegram";

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

  if (routing.admin) {
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

/**
 * Send notification to the module's admin group via Telegram.
 */
async function notifyAdmin(event: NotificationEvent): Promise<void> {
  try {
    const config = await getModuleBotConfig(event.moduleSlug);
    // Priority: module-specific chat ID → global DB setting → env fallback
    const chatId =
      config.telegramAdminChatId || await getGlobalAdminChatId();

    if (!chatId) {
      console.warn(
        `[Notifications] No admin chat configured for module: ${event.moduleSlug}`
      );
      return;
    }

    const message = renderAdminMessage(
      event.moduleSlug,
      event.type,
      event.data
    );
    if (!message) return;

    const botToken = config.telegramBotToken;
    const result = await telegramAdapter.send(chatId, message, { botToken });

    await logNotification({
      userId: null,
      channel: "TELEGRAM",
      eventType: event.type,
      moduleSlug: event.moduleSlug,
      entityId: event.entityId,
      recipient: chatId,
      message,
      status: result.success ? "SENT" : "FAILED",
      error: result.error,
    });
  } catch (err) {
    console.error("[Notifications] Admin notification failed:", err);
  }
}

/**
 * Get Telegram bot config for a module from Module.config JSON.
 * Falls back to global env vars.
 */
export async function getModuleBotConfig(
  moduleSlug: string
): Promise<ModuleBotConfig> {
  try {
    const mod = await prisma.module.findUnique({
      where: { slug: moduleSlug },
      select: { config: true },
    });

    const config = mod?.config as Record<string, unknown> | null;
    return {
      telegramBotToken:
        (config?.telegramBotToken as string) || undefined,
      telegramAdminChatId:
        (config?.telegramAdminChatId as string) || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Get the global admin chat ID from DB (system module config), fallback to env.
 */
async function getGlobalAdminChatId(): Promise<string | undefined> {
  try {
    const systemModule = await prisma.module.findUnique({
      where: { slug: "system" },
      select: { config: true },
    });
    const config = (systemModule?.config as Record<string, unknown>) || {};
    return (config.telegramAdminChatId as string) || process.env.TELEGRAM_ADMIN_CHAT_ID || undefined;
  } catch {
    return process.env.TELEGRAM_ADMIN_CHAT_ID || undefined;
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
