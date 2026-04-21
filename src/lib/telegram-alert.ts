/**
 * Shared helper for sending admin Telegram alerts directly via Bot API.
 * For client-facing notifications use the notifications module instead
 * (enqueueNotification / channels adapter with routing + preferences).
 */

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

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options.parseMode ?? "HTML",
        disable_web_page_preview: options.disableWebPagePreview ?? true,
      }),
    });
    if (!res.ok) {
      console.error(
        "[telegram-alert] Telegram API returned",
        res.status,
        await res.text().catch(() => "")
      );
    }
    return res.ok;
  } catch (err) {
    console.error("[telegram-alert] Failed to send Telegram message:", err);
    return false;
  }
}
