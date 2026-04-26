import type { NotificationChannelKind } from "@prisma/client";
import type {
  DeliveryResult,
  INotificationChannel,
  NotificationPayload,
} from "../types";

/**
 * Channel-agnostic Telegram channel.
 * Wraps the existing `bot/` Grammy adapter via direct API call.
 */
export class TelegramChannel implements INotificationChannel {
  readonly kind: NotificationChannelKind = "TELEGRAM";

  constructor(private readonly token: string | undefined = process.env.TELEGRAM_BOT_TOKEN) {}

  isAvailable(): boolean {
    return Boolean(this.token);
  }

  async send(address: string, payload: NotificationPayload): Promise<DeliveryResult> {
    if (!this.token) {
      return { ok: false, reason: "TELEGRAM_BOT_TOKEN not set", retryable: false };
    }
    const text = formatPayload(payload);
    const reply_markup = payload.actions?.length
      ? {
          inline_keyboard: payload.actions
            .filter((a) => a.url)
            .map((a) => [{ text: a.label, url: a.url! }]),
        }
      : undefined;

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: address,
          text,
          parse_mode: "HTML",
          reply_markup,
        }),
      });
      const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
      if (json.ok) return { ok: true, externalId: String(json.result?.message_id) };
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, reason: json.description ?? `HTTP ${res.status}`, retryable };
    } catch (err) {
      return { ok: false, reason: (err as Error).message, retryable: true };
    }
  }
}

function formatPayload(p: NotificationPayload): string {
  const escTitle = escapeHtml(p.title);
  const escBody = escapeHtml(p.body);
  return `<b>${escTitle}</b>\n\n${escBody}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
