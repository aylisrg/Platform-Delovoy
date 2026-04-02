/**
 * Telegram Alert Bot for Platform Delovoy.
 *
 * Sends alerts to the admin Telegram group when critical events occur.
 * Can be run as a standalone process or imported as a module.
 *
 * Usage:
 *   npx tsx bot/index.ts          — run standalone
 *   import { sendAlert } from './bot'  — use as module
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

type AlertLevel = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  INFO: "ℹ️",
  WARNING: "⚠️",
  ERROR: "🔴",
  CRITICAL: "🚨",
};

/**
 * Send an alert message to the admin Telegram group.
 */
export async function sendAlert(
  level: AlertLevel,
  source: string,
  message: string,
  details?: string
): Promise<boolean> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn("[Bot] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set, skipping alert");
    return false;
  }

  const emoji = LEVEL_EMOJI[level];
  const text = [
    `${emoji} <b>[${level}]</b> ${source}`,
    ``,
    message,
    details ? `\n<pre>${details}</pre>` : "",
    `\n<i>${new Date().toISOString()}</i>`,
  ].join("\n");

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      console.error("[Bot] Failed to send alert:", await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Bot] Error sending alert:", error);
    return false;
  }
}

// If run directly, send a test alert
if (require.main === module) {
  sendAlert("INFO", "system", "Bot started — test alert").then((sent) => {
    console.log(sent ? "Test alert sent" : "Test alert failed (check env vars)");
    process.exit(0);
  });
}
