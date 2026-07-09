import { telegramApi } from "@/lib/telegram/client";
import type { ChannelAdapter, UserWithContacts } from "../types";

/**
 * Telegram channel adapter.
 * Sends messages via Telegram Bot HTTP API.
 * Supports per-module bot tokens for admin notifications.
 */
export const telegramAdapter: ChannelAdapter = {
  channel: "TELEGRAM",

  async send(recipient, message, options) {
    const token = options?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    const res = await telegramApi(
      "sendMessage",
      { chat_id: recipient, text: message, parse_mode: "HTML" },
      { botToken: token }
    );

    if (!res.ok) {
      const error = res.transportError
        ? res.description
        : `Telegram API: ${res.status ?? ""} ${res.description}`.replace("  ", " ");
      return { success: false, error };
    }

    return { success: true };
  },

  resolveRecipient(user: UserWithContacts) {
    return user.telegramId || null;
  },
};
