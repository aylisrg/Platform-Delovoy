import type { BookingStatus } from "@prisma/client";
import type { BookingMetadata } from "./types";

/**
 * Ось оплаты — намеренно отдельная от `BookingStatus`.
 *
 * Владелец просил «статус ОПЛАЧЕНО, самый высший». В enum его класть нельзя:
 * жизненный цикл (кто где находится) и оплата (сколько денег получено) —
 * ортогональны. Бронь бывает CONFIRMED и уже полностью оплаченной онлайн,
 * а бывает COMPLETED с долгом (завершение силами CRON минует платёжный гейт).
 * Слив их в одно поле стёр бы одну из двух величин. Поэтому оплата —
 * производная величина от денег на брони, а в UI она рисуется рядом со
 * статусом жизненного цикла и выглядит для менеджера как «ещё один статус».
 */
export type BookingPaymentState =
  /** Платить нечего: счёт нулевой. */
  | "FREE"
  /** Денег не поступало. */
  | "UNPAID"
  /** Поступила часть суммы. */
  | "PARTIAL"
  /** Счёт закрыт полностью. */
  | "PAID"
  /** Бронь отменена, предоплата удержана как штраф — услуги не было. */
  | "PENALTY_HELD";

export type BookingPaymentSummary = {
  state: BookingPaymentState;
  /** Сколько всего нужно получить (с учётом скидки). */
  totalDue: number;
  /** Сколько фактически получено: касса + карта + онлайн. */
  paid: number;
  cash: number;
  card: number;
  online: number;
  /** Принято на месте до завершения брони. */
  prepaid: number;
  /** Остаток к оплате, не меньше нуля. */
  outstanding: number;
  /** Удержанный штраф при поздней отмене. */
  penalty: number;
  /** Готовая подпись для бейджа. */
  label: string;
  /** Короткая подпись для тесной сетки расписания. */
  shortLabel: string;
};

export type PaymentSummaryInput = {
  status: BookingStatus;
  cashAmount?: number | string | { toString(): string } | null;
  cardAmount?: number | string | { toString(): string } | null;
  metadata?: unknown;
};

/** Prisma отдаёт Decimal — не число и не строка. Приводим всё к числу. */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(
    typeof value === "string" ? value : (value as { toString(): string }).toString()
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

/**
 * Считает платёжную сводку брони из уже имеющихся полей — новых колонок в БД
 * не заводим. Источники денег (касса, карта, онлайн-предоплата ЮKassa)
 * складываются в одну сумму: менеджеру нужен один ответ «получили или нет»,
 * а не три индикатора (AC-6).
 */
export function getBookingPaymentSummary(
  booking: PaymentSummaryInput
): BookingPaymentSummary {
  const meta = (booking.metadata ?? {}) as BookingMetadata;

  const cash = toNumber(booking.cashAmount);
  const card = toNumber(booking.cardAmount);
  const online = toNumber(meta.onlinePaidAmount);
  // Предоплата на месте живёт в metadata, а не в колонках: колонки —
  // снапшот чекаута, завершение брони их перезаписывает.
  const prepaid =
    toNumber(meta.prepaidCashAmount) + toNumber(meta.prepaidCardAmount);
  const penalty = toNumber(meta.cancelPenalty?.amount);

  // Скидка уже записана в metadata.totalPrice при чекауте, но на брони, где
  // скидку применили, а totalPrice почему-то остался старым, доверяем
  // discount.finalAmount — это посчитанная сервером итоговая сумма.
  const totalDue = meta.discount
    ? toNumber(meta.discount.finalAmount)
    : toNumber(meta.totalPrice);

  const paid = cash + card + online + prepaid;
  const outstanding = Math.max(0, Math.round((totalDue - paid) * 100) / 100);

  // Отменённая бронь с удержанной предоплатой — не «оплачено»: услуги не было,
  // деньги остались как штраф. Отдельная формулировка, чтобы отчёт по выручке
  // и глаз менеджера не считали это выполненной работой (AC-5).
  if (booking.status === "CANCELLED" && penalty > 0) {
    return {
      state: "PENALTY_HELD",
      totalDue,
      paid,
      cash,
      card,
      online,
      prepaid,
      outstanding: 0,
      penalty,
      label: `Штраф удержан ${formatMoney(penalty)}`,
      shortLabel: "Штраф",
    };
  }

  if (totalDue <= 0) {
    return {
      state: paid > 0 ? "PAID" : "FREE",
      totalDue,
      paid,
      cash,
      card,
      online,
      prepaid,
      outstanding: 0,
      penalty,
      label: paid > 0 ? "ОПЛАЧЕНО" : "Без оплаты",
      shortLabel: paid > 0 ? "Оплачено" : "",
    };
  }

  if (outstanding <= 0) {
    return {
      state: "PAID",
      totalDue,
      paid,
      cash,
      card,
      online,
      prepaid,
      outstanding: 0,
      penalty,
      label: "ОПЛАЧЕНО",
      shortLabel: "Оплачено",
    };
  }

  if (paid > 0) {
    return {
      state: "PARTIAL",
      totalDue,
      paid,
      cash,
      card,
      online,
      prepaid,
      outstanding,
      penalty,
      label: `Оплачено ${formatMoney(paid)} из ${formatMoney(totalDue)}`,
      shortLabel: "Частично",
    };
  }

  return {
    state: "UNPAID",
    totalDue,
    paid,
    cash,
    card,
    online,
    prepaid,
    outstanding,
    penalty,
    label: `Не оплачено · ${formatMoney(totalDue)}`,
    shortLabel: "Не оплачено",
  };
}
