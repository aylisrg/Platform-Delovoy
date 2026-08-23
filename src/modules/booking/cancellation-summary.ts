import { PREPAID_CANCELLATION_POLICY } from "./types";

/**
 * Краткие условия отмены и переноса — единственный источник правды для трёх
 * мест сразу: блока над кнопкой оплаты, письма-подтверждения и страницы
 * управления бронью.
 *
 * Требование приёмки ТЗ §10 — «условия отмены в письме совпадают с текстом на
 * экране оплаты». Одна константа делает расхождение невозможным, а не
 * маловероятным.
 *
 * Текст СОБИРАЕТСЯ ИЗ ФАКТИЧЕСКИХ КОНСТАНТ ПОЛИТИКИ, а не переписан из ТЗ
 * §5.1.2. ТЗ и п. 7 оферты описывают возврат за вычетом фактически понесённых
 * расходов; система по решению владельца удерживает всю предоплату при отмене
 * позже порога. Показывать до оплаты условие, которого система не исполняет, —
 * ровно то нарушение ст. 8–10 ЗоЗПП, которое эта задача закрывает. Расхождение
 * вынесено юристу: правится текст оферты, после чего правится и эта константа.
 */

export const RESCHEDULE_NOTICE_HOURS = 24;
export const RESCHEDULE_WINDOW_DAYS = 90;

function hoursWord(hours: number): string {
  const mod10 = hours % 10;
  const mod100 = hours % 100;
  if (mod10 === 1 && mod100 !== 11) return "час";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "часа";
  return "часов";
}

export type CancellationSummary = {
  title: string;
  /** Пункты условий, сверху вниз. Порядок значим: сначала деньги, потом перенос. */
  lines: string[];
  /** Куда ведёт «Подробно» — раздел 7 оферты. */
  detailsHref: string;
  detailsLabel: string;
};

export function buildCancellationSummary(): CancellationSummary {
  const { thresholdHours, penaltyPercent } = PREPAID_CANCELLATION_POLICY;
  const threshold = `${thresholdHours} ${hoursWord(thresholdHours)}`;

  const refundLine =
    penaltyPercent >= 100
      ? `Отменить бронирование можно в любой момент. Если отменить более чем за ${threshold} до начала — вернём оплату полностью. Позже этого срока стоимость аренды не возвращается.`
      : `Отменить бронирование можно в любой момент. Если отменить более чем за ${threshold} до начала — вернём оплату полностью. Позже этого срока удерживается ${penaltyPercent} % стоимости аренды.`;

  return {
    title: "Отмена и перенос",
    lines: [
      refundLine,
      `Один раз бронь можно бесплатно перенести на другую дату, предупредив не позже чем за ${threshold} и выбрав дату в пределах ${RESCHEDULE_WINDOW_DAYS} дней.`,
      "Если не приехать и не предупредить — стоимость аренды беседки не возвращается.",
    ],
    detailsHref: "/oferta#p-7",
    detailsLabel: "п. 7 оферты",
  };
}

/** Плоский текст для писем и мест, где html не нужен. */
export function cancellationSummaryText(): string {
  const summary = buildCancellationSummary();
  return [summary.title, ...summary.lines].join("\n");
}
