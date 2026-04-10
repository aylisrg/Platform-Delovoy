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

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: recipient,
            text: message,
            parse_mode: "HTML",
          }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `Telegram API: ${res.status} ${text}` };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  resolveRecipient(user: UserWithContacts) {
    return user.telegramId || null;
  },
};
