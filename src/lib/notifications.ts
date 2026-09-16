import { telegramApi } from "@/lib/telegram/client";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";

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
 *
 * CRITICAL-only email fallback (issue #455): Telegram egress from the VPS
 * has been unreliable for weeks (api.telegram.org unreachable via v4 and
 * v6), and a CRITICAL alert nobody sees defeats the point of alerting.
 * `sendTransactionalEmail` is its own self-contained SMTP adapter (no DB),
 * so it degrades independently of whatever broke Telegram. Only CRITICAL
 * gets this — INFO/WARNING/ERROR staying Telegram-only (or silent when
 * unconfigured) matches the existing severity routing in CLAUDE.md.
 *
 * `source`/`message` are sent verbatim into both a Telegram HTML message
 * and (for CRITICAL) an email HTML body — callers must pre-escape any
 * untrusted content (the only current caller, `alertCritical` in
 * `src/lib/logger.ts`, does this via `escapeHtml()`).
 */
export async function sendAlert(
  level: AlertLevel,
  source: string,
  message: string,
  chatId?: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID;

  const emoji = LEVEL_EMOJI[level];
  const text = [
    `${emoji} <b>[${level}]</b> ${source}`,
    ``,
    message,
    ``,
    `<i>${new Date().toISOString()}</i>`,
  ].join("\n");

  let telegramOk = false;
  if (token && targetChatId) {
    const res = await telegramApi(
      "sendMessage",
      { chat_id: targetChatId, text, parse_mode: "HTML" },
      { botToken: token }
    );
    telegramOk = res.ok;
    if (!res.ok) {
      console.error("[Notifications] Failed to send Telegram alert:", res.description);
    }
  } else {
    console.warn("[Notifications] TELEGRAM_BOT_TOKEN or chat id not set, skipping alert");
  }

  if (telegramOk || level !== "CRITICAL") return telegramOk;

  const fallbackEmail = process.env.CRITICAL_ALERT_EMAIL;
  if (!fallbackEmail) return false;

  const emailResult = await sendTransactionalEmail({
    to: fallbackEmail,
    subject: `[${level}] ${source}`,
    html: text.replace(/\n/g, "<br>"),
    text: text.replace(/<[^>]+>/g, ""),
  });
  if (!emailResult.success) {
    console.error("[Notifications] Email fallback for CRITICAL alert failed:", emailResult.error);
  }
  return emailResult.success;
}
