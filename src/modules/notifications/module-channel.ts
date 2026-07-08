import { prisma } from "@/lib/db";
import type { NotificationEvent } from "./types";

/**
 * Dedicated per-module Telegram channel delivery.
 *
 * Independent from the per-user dispatch layer: this is a broadcast to a single
 * group/channel chat configured per module in `Module.config`, filtered by an
 * admin-controlled list of event types. No per-user preferences / quiet hours
 * apply — it's a module-wide feed.
 *
 * Config keys (Module.config JSON):
 *   - telegramChannelEnabled: boolean   — master switch
 *   - telegramChannelId: string         — chat_id or @username (bot must be able to post)
 *   - telegramChannelEvents: string[]   — enabled event types
 *   - telegramBotToken?: string         — optional per-module bot override
 */

type TemplateFn = (d: Record<string, unknown>) => string;

/**
 * HTML-formatted channel templates per module + event type.
 * Currently only gazebos defines a channel feed.
 */
const channelTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.created": (d) =>
      `🆕 <b>Новая бронь беседки</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.userName ? `\nКлиент: ${d.userName}` : ""}`,
    "booking.confirmed": (d) =>
      `✅ <b>Бронь подтверждена</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.updated": (d) =>
      `✏️ <b>Бронь изменена</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.userName ? `\nКлиент: ${d.userName}` : ""}${d.changes ? `\nИзменено: ${d.changes}` : ""}`,
    "booking.cancelled": (d) =>
      `❌ <b>Бронь отменена</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.userName ? `\nКлиент: ${d.userName}` : ""}`,
    "booking.completed": (d) =>
      `🏁 <b>Бронь завершена</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.deleted": (d) =>
      `🗑 <b>Бронь удалена</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.userName ? `\nКлиент: ${d.userName}` : ""}`,
    "booking.reminder": (d) =>
      `⏰ <b>Напоминание</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
  },
};

function renderChannelMessage(
  moduleSlug: string,
  eventType: string,
  data: Record<string, unknown>
): string | null {
  const template = channelTemplates[moduleSlug]?.[eventType];
  if (!template) return null;
  return template(data);
}

/**
 * Deliver an event to the module's dedicated Telegram channel when enabled and
 * the event type is toggled on. Fails soft — never throws to the caller.
 */
export async function dispatchModuleChannel(
  event: NotificationEvent
): Promise<void> {
  try {
    const moduleRecord = await prisma.module.findUnique({
      where: { slug: event.moduleSlug },
      select: { config: true },
    });
    const config = (moduleRecord?.config as Record<string, unknown>) ?? {};

    if (config.telegramChannelEnabled !== true) return;

    const chatId =
      typeof config.telegramChannelId === "string"
        ? config.telegramChannelId.trim()
        : "";
    if (!chatId) return;

    const enabledEvents = Array.isArray(config.telegramChannelEvents)
      ? (config.telegramChannelEvents as string[])
      : [];
    if (!enabledEvents.includes(event.type)) return;

    const text = renderChannelMessage(event.moduleSlug, event.type, event.data);
    if (!text) return;

    const token =
      (typeof config.telegramBotToken === "string" && config.telegramBotToken) ||
      process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn(
        "[ModuleChannel] TELEGRAM_BOT_TOKEN not set, skipping channel delivery"
      );
      return;
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );
    if (!res.ok) {
      console.error(
        "[ModuleChannel] Telegram send failed:",
        await res.text().catch(() => res.status)
      );
    }
  } catch (err) {
    console.error("[ModuleChannel] Dispatch error:", err);
  }
}
