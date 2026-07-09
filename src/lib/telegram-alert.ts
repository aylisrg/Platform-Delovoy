/**
 * Shared helper for sending admin Telegram alerts directly via Bot API.
 * For client-facing notifications use the notifications module instead
 * (enqueueNotification / channels adapter with routing + preferences).
 */

import { telegramApi } from "@/lib/telegram/client";

export type TelegramAlertOptions = {
  chatId?: string;
  botToken?: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  disableWebPagePreview?: boolean;
};

export async function sendTelegramAlert(
  message: string,
  options: TelegramAlertOptions = {}
): Promise<boolean> {
  const token = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    console.warn(
      "[telegram-alert] TELEGRAM_BOT_TOKEN or chat id not configured — alert skipped"
    );
    return false;
  }

  const res = await telegramApi(
    "sendMessage",
    {
      chat_id: chatId,
      text: message,
      parse_mode: options.parseMode ?? "HTML",
      disable_web_page_preview: options.disableWebPagePreview ?? true,
    },
    { botToken: token }
  );
  if (!res.ok) {
    if (res.transportError) {
      console.error("[telegram-alert] Failed to send Telegram message:", res.description);
    } else {
      console.error("[telegram-alert] Telegram API returned", res.status, res.description);
    }
  }
  return res.ok;
}
