import type { NotificationChannelKind } from "@prisma/client";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/escape";
import type {
  DeliveryFailureCode,
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
    return {
      ok: false,
      reason: res.description,
      retryable: res.retryable,
      code: classifyTelegramFailure(res.description, res.status, res.transportError),
    };
  }
}

/**
 * Telegram error → normalized code. BOT_* drive «бот заблокирован / не запущен»
 * (ADR 2026-10-25 §Q5); texts are Bot API `description`s.
 */
export function classifyTelegramFailure(
  description: string,
  status: number | undefined,
  transportError = false,
): DeliveryFailureCode {
  if (/bot was blocked by the user/i.test(description)) return "BOT_BLOCKED";
  if (/user is deactivated/i.test(description)) return "USER_DEACTIVATED";
  if (/bot can't initiate conversation|chat not found/i.test(description)) return "BOT_NOT_STARTED";
  if (transportError || status === 429 || (status !== undefined && status >= 500)) return "NETWORK";
  return "OTHER";
}

function formatPayload(p: NotificationPayload): string {
  const escTitle = escapeHtml(p.title);
  const escBody = escapeHtml(p.body);
  return `<b>${escTitle}</b>\n\n${escBody}`;
}
