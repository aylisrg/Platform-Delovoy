import type { DeliveryFailureCode } from "./dispatch/types";
import type { SkipReason } from "./skips";

/**
 * Human labels for delivery outcomes (AC-D2.3: no Telegram technical codes in
 * the UI). ADR 2026-10-25-team-access-notifications §5.2.
 *
 * Leaf module — no DB imports: used by the stats service and by client
 * components alike.
 */

export const FAILURE_CODE_LABELS: Record<DeliveryFailureCode, string> = {
  BOT_BLOCKED: "Бот заблокирован",
  BOT_NOT_STARTED: "Бот не запущен",
  USER_DEACTIVATED: "Аккаунт Telegram удалён",
  NETWORK: "Канал недоступен",
  CHANNEL_UNAVAILABLE: "Канал недоступен",
  OTHER: "Канал недоступен",
  CHANNEL_EXPIRED: "Подписка браузера недействительна",
  CHANNEL_AUTH: "Подписка браузера недействительна",
  STALE: "Не отправлено вовремя",
};

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  NO_CHANNEL: "Нет канала",
  DND: "Не беспокоить",
  OPTED_OUT: "Отключено сотрудником",
  PREFERENCE_DISABLED: "Отключено сотрудником",
  DUPLICATE: "Дубль",
};

/** Channels shown in the delivery statistics (`IN_APP` = InAppNotification). */
export const STATS_CHANNELS = ["TELEGRAM", "PUSH", "EMAIL", "IN_APP"] as const;
export type StatsChannel = (typeof STATS_CHANNELS)[number];

const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: "Telegram",
  PUSH: "Web Push",
  EMAIL: "Email",
  IN_APP: "Лента Mini App",
  VK: "VK",
  MAX: "MAX",
  WHATSAPP: "WhatsApp",
  IMESSAGE: "iMessage",
  SMS: "SMS",
  AVITO: "Авито",
};

function hasKey<T extends string>(map: Record<T, string>, key: string): key is T {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/** Failure reason; unknown codes read as «Канал недоступен» — never the raw code. */
export function failureLabel(code: string | null | undefined): string {
  if (code && hasKey(FAILURE_CODE_LABELS, code)) return FAILURE_CODE_LABELS[code];
  return FAILURE_CODE_LABELS.OTHER;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase("ru-RU") + text.slice(1);
}

/** «Ошибка: бот заблокирован» (AC-D2.2); rows from before failure codes existed → «Ошибка». */
export function failureStatusLabel(code: string | null | undefined): string {
  if (!code) return "Ошибка";
  return `Ошибка: ${lowerFirst(failureLabel(code))}`;
}

export function skipReasonLabel(reason: string): string {
  return hasKey(SKIP_REASON_LABELS, reason) ? SKIP_REASON_LABELS[reason] : "Пропущено";
}

/** «Пропущено: нет канала». */
export function skipStatusLabel(reason: string): string {
  return hasKey(SKIP_REASON_LABELS, reason) ? `Пропущено: ${lowerFirst(SKIP_REASON_LABELS[reason])}` : "Пропущено";
}

export function channelLabel(kind: string | null | undefined): string {
  if (!kind) return "—";
  return CHANNEL_LABELS[kind] ?? kind;
}

export const DELIVERY_STATUS_LABELS = {
  DELIVERED: "Доставлено",
  IN_FLIGHT: "В обработке",
} as const;
