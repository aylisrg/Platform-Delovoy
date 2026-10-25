import type { RecentNotificationItem, StatsMeasuredSince } from "@/modules/notifications/types";

/**
 * Texts and formatting shared by the statistics page and the staff-page block
 * (PRD 2026-10-25 US-D1/D2, glossary «Определения»). Pure, no React.
 */

/** AC-D1.4 — permanent caption next to «Прочитано» and the Telegram row. */
export const TELEGRAM_READ_CAPTION =
  "Telegram не сообщает о прочтении — для Telegram считаем только переходы по кнопкам. Мало кликов не значит, что сообщение не прочитано";

export const PUSH_READ_CAPTION = "Web Push тоже не сообщает о прочтении — считаем только переходы по ссылке.";

export const GROUP_CHATS_CAPTION =
  "Общие чаты разделов (прежний журнал): только отправлено и ошибки — без прочтений, реакций и привязки к человеку.";

/** «i» tooltips — glossary definitions (AC-D1.2). */
export const GLOSSARY = {
  sent: "Отправлено — система создала уведомление сотруднику и пыталась его отправить (включая ушедшие в повтор). Повтор через другой канал — то же уведомление.",
  delivered:
    "Доставлено — канал принял сообщение: Telegram вернул подтверждение, push-сервис принял, карточка появилась в ленте Mini App.",
  failed:
    "Ошибка — не удалось доставить после всех повторов (причина видна в «Последних уведомлениях» сотрудника). Пропуски сюда не входят.",
  inFlight: "В обработке — ещё отправляется, ждёт повтора или окончания тихих часов.",
  read: "Прочитано — только лента Mini App: карточка открыта или отмечена прочитанной. «Прочитать всё» прочтением не считается. Telegram и Web Push отметок о прочтении не дают.",
  clicks:
    "Клик — переход по кнопке или ссылке из Telegram-сообщения, Web Push или карточки ленты. Считаем уведомления с кликом; повторные клики — отдельно, во «всего кликов».",
  reactionRate:
    "Доля реакции = уведомления с реакцией / измеримые доставленные. Реакция — первое из: прочтение в ленте или клик; одно уведомление даёт не более одной реакции. Ошибки и пропуски в знаменатель не входят.",
  median:
    "Время до реакции — от доставки до первой реакции. Показываем медиану по уведомлениям с реакцией и долю измеримых, на которые не отреагировали за 24 часа.",
  unmeasurable:
    "Реакцию измерить нельзя — доставленные уведомления без кнопки или ссылки вне ленты (например, Telegram без кнопки). В долю реакции не входят.",
  skips:
    "Пропущено — отправка не пыталась: нет канала, «не беспокоить», отключено сотрудником, дубль. Это не ошибки доставки.",
} as const;

export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** 45 → «45 с», 720 → «12 мин», 3900 → «1 ч 5 мин», 90000 → «1 дн 1 ч». */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} дн ${restHours} ч` : `${days} дн`;
}

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

const DATE_TIME_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return DATE_TIME_FMT.format(new Date(iso));
}

/** AC-D1.8 — never show bare zeros for days before tracking started. */
export function measuredSinceText(measuredSince: StatsMeasuredSince): string | null {
  if (!measuredSince.partial) return null;
  if (!measuredSince.clicks) return "Клики и прочтения пока не измеряются — данных за этот период нет.";
  return `Клики измеряются с ${formatDate(measuredSince.clicks)}; за более ранние дни данных нет.`;
}

/** AC-D2.2 — «Прочитано через 3 мин» / «Клик через 12 мин» / «Нет реакции». */
export function reactionText(item: Pick<RecentNotificationItem, "status" | "measurable" | "reaction">): string {
  if (item.status !== "DELIVERED") return "—";
  if (item.reaction) {
    const after = formatDuration(item.reaction.afterSeconds);
    return item.reaction.kind === "read" ? `Прочитано через ${after}` : `Клик через ${after}`;
  }
  return item.measurable ? "Нет реакции" : "Реакцию измерить нельзя";
}

export const PERIOD_OPTIONS = [7, 30, 90] as const;
export type PeriodOption = (typeof PERIOD_OPTIONS)[number];
