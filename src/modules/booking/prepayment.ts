import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVE_BOOKING_STATUSES } from "./state-machine";
import type { BookingMetadata } from "./types";

/**
 * Приём оплаты до завершения брони (#511).
 *
 * Раньше деньги попадали в систему единственным способом — через модалку
 * счёта при завершении. Поэтому предоплата наличными «по телефону»
 * записывалась только в голове менеджера, а бронь до самого чекаута
 * выглядела неоплаченной. Владелец просил статус «ОПЛАЧЕНО», который можно
 * поставить, — вот способ его поставить.
 *
 * Деньги пишутся в `metadata.prepaid*`, а не в колонки `cashAmount`/
 * `cardAmount`: те — снапшот чекаута, завершение брони их перезаписывает,
 * и предоплата бесследно исчезла бы. Заодно это симметрично уже
 * работающему `onlinePaidAmount`.
 */

export class BookingPrepaymentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BookingPrepaymentError";
  }
}

export type RecordPrepaymentInput = {
  bookingId: string;
  moduleSlug: string;
  actorId: string;
  cashAmount: number;
  cardAmount: number;
};

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Сколько уже принято на месте до завершения брони. */
export function getPrepaidAmount(metadata: unknown): number {
  const meta = (metadata ?? {}) as BookingMetadata;
  return toNumber(meta.prepaidCashAmount) + toNumber(meta.prepaidCardAmount);
}

/**
 * Записывает принятые деньги, не трогая статус жизненного цикла брони.
 *
 * Суммы **накапливаются**: гость может доплачивать частями, и второй приём
 * не должен затирать первый. Кассовая строка в леджере создаётся сразу —
 * деньги в кассе уже лежат, ждать чекаута нельзя, иначе сверка смены не
 * сойдётся.
 */
export async function recordPrepayment(input: RecordPrepaymentInput) {
  const { bookingId, moduleSlug, actorId, cashAmount, cardAmount } = input;

  if (cashAmount <= 0 && cardAmount <= 0) {
    throw new BookingPrepaymentError("NOTHING_TO_RECORD", "Укажите сумму оплаты");
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug, deletedAt: null },
  });
  if (!booking) {
    throw new BookingPrepaymentError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  // У закрытой брони приём оплаты — это не предоплата, а правка задним
  // числом: она разъехалась бы с уже проведённым чекаутом и сломала бы
  // сверку смены. Такие случаи — через восстановление брони.
  if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
    throw new BookingPrepaymentError(
      "BOOKING_CLOSED",
      "Бронь уже закрыта — оплату по ней принять нельзя"
    );
  }

  const meta = (booking.metadata as BookingMetadata | null) ?? {};
  const nextCash = toNumber(meta.prepaidCashAmount) + cashAmount;
  const nextCard = toNumber(meta.prepaidCardAmount) + cardAmount;

  const resource = await prisma.resource.findUnique({
    where: { id: booking.resourceId },
    select: { name: true },
  });
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { name: true, email: true },
  });
  const actorName = actor?.name ?? actor?.email ?? "Менеджер";

  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        metadata: {
          ...meta,
          prepaidCashAmount: nextCash.toFixed(2),
          prepaidCardAmount: nextCard.toFixed(2),
          prepaidAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.financialTransaction.create({
      data: {
        moduleSlug,
        type: "SESSION_PAYMENT",
        bookingId,
        totalAmount: cashAmount + cardAmount,
        cashAmount,
        cardAmount,
        performedById: actorId,
        performedByName: actorName,
        description: `Предоплата: ${resource?.name ?? "—"} · ${booking.clientName ?? "—"}`,
        metadata: {
          kind: "prepayment",
          resourceName: resource?.name ?? "—",
          clientName: booking.clientName ?? "—",
          date: booking.date.toISOString().split("T")[0],
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "booking.paid",
        entity: "Booking",
        entityId: bookingId,
        metadata: {
          moduleSlug,
          cashAmount,
          cardAmount,
          totalAmount: cashAmount + cardAmount,
          prepaidTotal: nextCash + nextCard,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}
