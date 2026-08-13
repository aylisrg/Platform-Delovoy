import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVE_BOOKING_STATUSES, assertValidTransition } from "./state-machine";
import { lockSlot } from "./slot-lock";
import { refundToSubscription } from "@/modules/subscriptions/debit";

/**
 * Восстановление ошибочно завершённой или отменённой брони (#511).
 *
 * Строка `Booking` при завершении и отмене физически не удаляется — меняется
 * только `status`, поэтому снепшот, как в `DeletionLog`, здесь не нужен: это
 * обычный переход состояния, но с тремя обязательными проверками.
 */

/**
 * Окно восстановления. Сутки покрывают «ошиблись в смену — заметили утром»,
 * но не превращают кнопку в машину времени: чем старше бронь, тем выше шанс,
 * что слот уже пересдан, деньги сведены, а смена закрыта.
 */
export const RESTORE_WINDOW_HOURS = 24;

export class BookingRestoreError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "BookingRestoreError";
    this.metadata = metadata;
  }
}

export type RestoreBookingInput = {
  bookingId: string;
  moduleSlug: string;
  /** SUPERADMIN — проверяется в роуте до вызова. */
  actorId: string;
  reason?: string;
};

/** Сколько часов осталось до закрытия окна восстановления; 0 — окно закрыто. */
export function restoreWindowHoursLeft(closedAt: Date, now: Date = new Date()): number {
  const elapsedHours = (now.getTime() - closedAt.getTime()) / (1000 * 60 * 60);
  return Math.max(0, Math.round((RESTORE_WINDOW_HOURS - elapsedHours) * 10) / 10);
}

/**
 * Возвращает бронь в CONFIRMED.
 *
 * Деньги намеренно не откатываются (AC-6): `FinancialTransaction` —
 * иммутабельный леджер, задним числом выручку не переписываем, иначе отчёты
 * «внезапно уменьшатся» без следа. Уже прошедший возврат ЮKassa тоже не
 * отменяется — технически невозможно, только предупреждение в диалоге.
 * Товары, возвращённые на склад при отмене, повторно не списываются: их
 * состав мог измениться, пусть менеджер добавит их заново осознанно.
 */
export async function restoreBooking(input: RestoreBookingInput) {
  const { bookingId, moduleSlug, actorId, reason } = input;

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug, deletedAt: null },
  });
  if (!booking) {
    throw new BookingRestoreError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  if (booking.status !== "COMPLETED" && booking.status !== "CANCELLED") {
    throw new BookingRestoreError(
      "NOT_RESTORABLE",
      "Восстанавливать можно только завершённую или отменённую бронь"
    );
  }

  // `updatedAt` — момент последнего изменения строки, то есть закрытия брони.
  // Точнее ничего нет: отдельного `closedAt` в модели не заводим ради одной
  // проверки, а редактировать закрытую бронь всё равно нечем.
  const hoursLeft = restoreWindowHoursLeft(booking.updatedAt);
  if (hoursLeft <= 0) {
    throw new BookingRestoreError(
      "RESTORE_WINDOW_EXPIRED",
      `Восстановление доступно в течение ${RESTORE_WINDOW_HOURS} ч после закрытия брони. Окно истекло — заведите новую бронь.`,
      { closedAt: booking.updatedAt.toISOString() }
    );
  }

  assertValidTransition({
    currentStatus: booking.status,
    targetStatus: "CONFIRMED",
    actorRole: "SUPERADMIN",
    now: new Date(),
    startTime: booking.startTime,
    noShowThresholdMinutes: 30,
  });

  return prisma.$transaction(async (tx) => {
    // Блокировка слота обязана быть первым стейтментом — иначе между
    // конфликт-чеком и записью влезет параллельная бронь. Ровно та дыра,
    // из-за которой реактивация NO_SHOW создаёт двойные брони (#478);
    // повторять её в новой фиче нельзя (AC-3).
    await lockSlot(tx, moduleSlug, booking.resourceId, booking.date);

    const conflict = await tx.booking.findFirst({
      where: {
        id: { not: bookingId },
        moduleSlug,
        deletedAt: null,
        resourceId: booking.resourceId,
        status: { in: ACTIVE_BOOKING_STATUSES },
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
      },
      select: { id: true, clientName: true, startTime: true, endTime: true },
    });

    if (conflict) {
      throw new BookingRestoreError(
        "SLOT_TAKEN",
        "Слот уже занят другой бронью — восстановление невозможно",
        {
          conflictBookingId: conflict.id,
          conflictClientName: conflict.clientName,
        }
      );
    }

    // updateMany со сторожем по статусу: если параллельный запрос успел
    // восстановить бронь, count === 0 и мы не пишем второе событие в журнал.
    const res = await tx.booking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: { status: "CONFIRMED", managerId: actorId },
    });
    if (res.count === 0) {
      throw new BookingRestoreError(
        "ALREADY_RESTORED",
        "Бронь уже изменена другим администратором"
      );
    }

    // #435: если бронь оплачена абонементом ps-park (debitFromSession на
    // COMPLETED), восстановление обязано вернуть списанные часы — иначе гость
    // теряет их без компенсации. Сумма hoursDelta по всем
    // SubscriptionTransaction этой брони (CHARGE отрицательны, REFUND
    // положительны) — сколько ещё не возвращено; ноль — не списывалось или
    // уже возвращено. Именно так, а не «есть ли CHARGE», чтобы повторная
    // отмена/восстановление той же брони не задваивала возврат.
    let subscriptionRefund:
      | { subscriptionId: string; hoursRefunded: number }
      | undefined;
    if (moduleSlug === "ps-park") {
      const subTx = await tx.subscriptionTransaction.findMany({
        where: { bookingId },
        select: { subscriptionId: true, hoursDelta: true },
      });
      const netOwed = -subTx.reduce((sum, t) => sum + Number(t.hoursDelta), 0);
      if (netOwed > 0) {
        // Все транзакции по одной брони относятся к одному абонементу —
        // списание бывает ровно один раз, за сессию.
        const subscriptionId = subTx[0].subscriptionId;
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { name: true, email: true },
        });
        const refund = await refundToSubscription(tx, {
          subscriptionId,
          bookingId,
          hours: netOwed,
          performedById: actorId,
          performedByName: actor?.name ?? actor?.email ?? "Администратор",
          reason: reason ?? "Восстановление отменённой/завершённой брони",
        });
        subscriptionRefund = { subscriptionId, hoursRefunded: refund.hoursRefunded };
      }
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "booking.restore",
        entity: "Booking",
        entityId: bookingId,
        metadata: {
          moduleSlug,
          previousStatus: booking.status,
          newStatus: "CONFIRMED",
          ...(reason && { reason }),
          // Деньги и склад остались как были — фиксируем это явно, чтобы
          // расхождение отчётов потом было объяснимо.
          revenueKept: booking.status === "COMPLETED",
          cashAmount: booking.cashAmount?.toString() ?? null,
          cardAmount: booking.cardAmount?.toString() ?? null,
          ...(subscriptionRefund && { subscriptionRefund }),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  });
}
