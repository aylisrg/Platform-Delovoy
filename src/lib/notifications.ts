import { telegramApi } from "@/lib/telegram/client";

type AlertLevel = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  INFO: "ℹ️",
  WARNING: "⚠️",
  ERROR: "🔴",
  CRITICAL: "🚨",
};

/**
 * Send an alert message to the admin Telegram group (or, with an explicit
 * `chatId`, any other chat — e.g. the owner's personal DM) via HTTP API.
 * Self-contained — no dependency on the bot process.
 */
export async function sendAlert(
  level: AlertLevel,
  source: string,
  message: string,
  chatId?: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !targetChatId) {
    console.warn("[Notifications] TELEGRAM_BOT_TOKEN or chat id not set, skipping alert");
    return false;
  }

  const emoji = LEVEL_EMOJI[level];
  const text = [
    `${emoji} <b>[${level}]</b> ${source}`,
    ``,
    message,
    ``,
    `<i>${new Date().toISOString()}</i>`,
  ].join("\n");

  const res = await telegramApi(
    "sendMessage",
    { chat_id: targetChatId, text, parse_mode: "HTML" },
    { botToken: token }
  );
  if (!res.ok) {
    console.error("[Notifications] Failed to send Telegram alert:", res.description);
  }
  return res.ok;
}
