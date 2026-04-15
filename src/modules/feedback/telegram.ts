import { readFileSync, existsSync } from "fs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Send an urgent feedback alert to the admin Telegram chat.
 * Sends text message, then screenshot (if available) as a separate photo.
 */
export async function sendUrgentFeedbackAlert(params: {
  feedbackId: string;
  type: "BUG" | "SUGGESTION";
  description: string;
  userName: string;
  pageUrl: string;
  screenshotPath?: string;
}): Promise<boolean> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn("[Feedback] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set, skipping alert");
    return false;
  }

  const typeLabel = params.type === "BUG" ? "Ошибка" : "Предложение";
  const adminUrl = `${APP_URL}/admin/feedback/${params.feedbackId}`;
  const truncatedDesc = params.description.slice(0, 500);

  const text = [
    `🚨 <b>СРОЧНОЕ обращение!</b>`,
    ``,
    `<b>Тип:</b> ${typeLabel}`,
    `<b>От:</b> ${escapeHtml(params.userName)}`,
    `<b>Страница:</b> ${escapeHtml(params.pageUrl)}`,
    ``,
    escapeHtml(truncatedDesc),
    ``,
    `<a href="${adminUrl}">Открыть в панели</a>`,
  ].join("\n");

  try {
    // Send text message
    const msgResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          text,
          parse_mode: "HTML",
        }),
      }
    );

    if (!msgResponse.ok) {
      console.error("[Feedback TG] Failed to send message:", await msgResponse.text());
      return false;
    }

    // Send screenshot if present
    if (params.screenshotPath && existsSync(params.screenshotPath)) {
      const fileBuffer = readFileSync(params.screenshotPath);
      const formData = new FormData();
      formData.append("chat_id", ADMIN_CHAT_ID);
      formData.append(
        "photo",
        new Blob([fileBuffer]),
        `screenshot.${params.screenshotPath.split(".").pop()}`
      );
      formData.append("caption", `Скриншот к обращению`);

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        body: formData,
      });
    }

    return true;
  } catch (error) {
    console.error("[Feedback TG] Error sending alert:", error);
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
