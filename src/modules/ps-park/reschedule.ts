import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseMoscowDateTime } from "@/lib/format";
import { lockSlot, handleOverlapBackstop } from "@/modules/booking/slot-lock";
import { ACTIVE_BOOKING_STATUSES } from "@/modules/booking/state-machine";
import { isPSParkReservation } from "@/modules/booking/payment-flow";
import { saleBookingItems } from "@/modules/inventory/service";
import type { BookingItemSnapshot } from "@/modules/inventory/types";
import { PSBookingError, getOpenCloseHours } from "./service";
import type { ReschedulePSReservationInput } from "./validation";

/** Manager-assisted move of unused prepaid time. No payment/refund is created. */
export async function reschedulePaidReservation(id: string, actorId: string, input: ReschedulePSReservationInput) {
  const initial = await prisma.booking.findFirst({ where: { id, moduleSlug: "ps-park", deletedAt: null } });
  if (!initial || !isPSParkReservation(initial)) {
    throw new PSBookingError("BOOKING_NOT_FOUND", "Онлайн-бронь Плей Парка не найдена");
  }
  const resource = await prisma.resource.findFirst({ where: { id: initial.resourceId, moduleSlug: "ps-park", isActive: true } });
  if (!resource) throw new PSBookingError("RESOURCE_NOT_FOUND", "Стол недоступен");
  const { openHour, closeHour } = await getOpenCloseHours();
  const date = new Date(input.date);
  const start = parseMoscowDateTime(input.date, input.startTime);
  const startHour = Number(input.startTime.slice(0, 2)) + Number(input.startTime.slice(3)) / 60;

  return prisma.$transaction(async (tx) => {
    await lockSlot(tx, "ps-park", initial.resourceId, date);
    // Serialize against payment/cancellation metadata writes and concurrent moves.
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${id} FOR UPDATE`;
    const booking = await tx.booking.findFirst({ where: { id, moduleSlug: "ps-park", deletedAt: null } });
    if (!booking || !isPSParkReservation(booking)) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронь не найдена");
    const metadata = (booking.metadata as Record<string, unknown> | null) ?? {};
    if (!["CONFIRMED", "CANCELLED", "NO_SHOW"].includes(booking.status) || metadata.checkedInAt || metadata.lateCheckedInAt) {
      throw new PSBookingError("RESCHEDULE_NOT_ALLOWED", "Перенести можно оплаченную бронь, по которой ещё не играли");
    }
    const paid = await tx.payment.findFirst({
      where: {
        subjectType: "BOOKING", subjectId: id, moduleSlug: "ps-park", status: "SUCCEEDED", refundedAmount: 0,
        metadata: { path: ["paymentPurpose"], equals: "reservation" },
        refunds: { none: { status: { in: ["pending", "succeeded"] } } },
      }, select: { amount: true },
    });
    if (!paid || Number(paid.amount) !== Number(metadata.totalPrice)) {
      throw new PSBookingError("PAYMENT_REQUIRED", "Нет подтверждённой предоплаты для переноса");
    }
    const duration = Number(metadata.reservationDurationMinutes) * 60_000;
    if (!Number.isFinite(duration) || duration <= 0 ||
        duration !== booking.endTime.getTime() - booking.startTime.getTime() ||
        Number(metadata.reservationItemsTotal) !== Number(metadata.itemsTotal ?? 0)) {
      throw new PSBookingError("RESERVATION_CHANGED", "Период или товары изменены после оплаты. Перед переносом требуется сверка оплаченной брони");
    }
    const end = new Date(start.getTime() + duration);
    if (start <= new Date() || duration <= 0 || startHour < openHour || startHour + duration / 3_600_000 > closeHour) {
      throw new PSBookingError("INVALID_BOOKING_TIME", "Выберите будущее время в пределах часов работы; длительность сохраняется");
    }
    if (booking.status === "CONFIRMED" && booking.startTime.getTime() === start.getTime()) return booking;
    if (booking.startTime.getTime() !== new Date(input.expectedStartTime).getTime()) {
      throw new PSBookingError("BOOKING_CHANGED", "Бронь уже изменена. Обновите страницу");
    }
    const conflict = await tx.booking.findFirst({ where: {
      id: { not: id }, moduleSlug: "ps-park", resourceId: booking.resourceId, deletedAt: null,
      status: { in: ACTIVE_BOOKING_STATUSES }, date,
      startTime: { lt: end }, endTime: { gt: start },
    } });
    if (conflict) throw new PSBookingError("BOOKING_CONFLICT", "Это время уже занято");
    const from = { date: booking.date.toISOString().slice(0, 10), startTime: booking.startTime.toISOString(), endTime: booking.endTime.toISOString() };
    const updated = await tx.booking.update({ where: { id }, data: {
      date, startTime: start, endTime: end, status: "CONFIRMED", cancelReason: null,
      metadata: { ...metadata, rescheduledFrom: from, lastRescheduledAt: new Date().toISOString(),
        rescheduleCount: Number(metadata.rescheduleCount ?? 0) + 1 } as Prisma.InputJsonValue,
    } });
    if (booking.status === "CANCELLED") {
      const items = (metadata.items ?? []) as BookingItemSnapshot[];
      if (items.length) await saleBookingItems(tx, id, "ps-park", items, actorId);
    }
    await tx.auditLog.create({ data: {
      userId: actorId, action: "booking.reschedule", entity: "Booking", entityId: id,
      metadata: { moduleSlug: "ps-park", from, to: { date: input.date, startTime: start.toISOString(), endTime: end.toISOString() }, paymentPreserved: true },
    } });
    return updated;
  }).catch(async (error) => {
    if (await handleOverlapBackstop(error, "ps-park", initial.resourceId)) {
      throw new PSBookingError("BOOKING_CONFLICT", "Это время уже занято");
    }
    throw error;
  });
}
