import type { NotificationChannelKind } from "@prisma/client";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/escape";
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

    const res = await telegramApi<{ message_id?: number }>(
      "sendMessage",
      { chat_id: address, text, parse_mode: "HTML", reply_markup },
      { botToken: this.token }
    );
    if (res.ok) return { ok: true, externalId: String(res.result?.message_id) };
    return { ok: false, reason: res.description, retryable: res.retryable };
  }
}

function formatPayload(p: NotificationPayload): string {
  const escTitle = escapeHtml(p.title);
  const escBody = escapeHtml(p.body);
  return `<b>${escTitle}</b>\n\n${escBody}`;
}
