import type { Payment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { createCalendarEvent } from "@/lib/google-calendar";
import { enqueueNotification } from "@/modules/notifications/queue";
import { saleBookingItems } from "@/modules/inventory/service";
import type { BookingItemSnapshot } from "@/modules/inventory/types";
import { EVENT_SOURCES } from "@/lib/event-sources";

/**
 * Доменные эффекты платежей с subjectType=BOOKING.
 *
 * Два сценария:
 * - gazebos, бронь в PENDING → 100 % предоплата: подтверждаем бронь
 *   (CONFIRMED) и списываем инвентарь — как это делает менеджер при ручном
 *   подтверждении (см. gazebos/service.ts updateBookingStatus).
 * - ps-park (или уже подтверждённая бронь) → оплата счёта: только зачисляем
 *   сумму в metadata.onlinePaidAmount, статус не трогаем.
 *
 * Внешние вызовы (Google Calendar, уведомления) — строго ПОСЛЕ коммита
 * транзакции, в after*-функциях.
 */

type Tx = Prisma.TransactionClient;

function bookingTimeStrings(booking: { date: Date; startTime: Date; endTime: Date }) {
  return {
    date: booking.date.toISOString().split("T")[0],
    startTime: formatTime(booking.startTime),
    endTime: formatTime(booking.endTime),
  };
}

export async function onBookingPaymentSucceeded(tx: Tx, payment: Payment): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: payment.subjectId } });
  if (!booking) {
    // eslint-disable-next-line no-restricted-syntax -- атомарная запись внутри $transaction, logger.ts вне её недопустим
    await tx.systemEvent.create({
      data: {
        level: "ERROR",
        source: EVENT_SOURCES.PAYMENTS,
        message: "Оплата получена, но бронь не найдена",
        metadata: { paymentId: payment.id, bookingId: payment.subjectId },
      },
    });
    return;
  }

  const metadata = (booking.metadata as Record<string, unknown> | null) ?? {};
  const prevOnline = Number((metadata.onlinePaidAmount as string | undefined) ?? 0);
  const newMetadata = {
    ...metadata,
    onlinePaidAmount: (prevOnline + Number(payment.amount)).toFixed(2),
    paymentId: payment.id,
  } as Prisma.InputJsonValue;

  if (booking.moduleSlug === "gazebos" && booking.status === "PENDING") {
    const res = await tx.booking.updateMany({
      where: { id: booking.id, status: "PENDING" },
      data: { status: "CONFIRMED", metadata: newMetadata },
    });
    if (res.count > 0) {
      // Инвентарь списывается при подтверждении — тот же контракт, что и при
      // ручном CONFIRMED менеджером.
      const items = (metadata.items ?? []) as BookingItemSnapshot[];
      if (items.length > 0) {
        await saleBookingItems(tx, booking.id, booking.moduleSlug, items, "system");
      }
    }
  } else {
    await tx.booking.update({
      where: { id: booking.id },
      data: { metadata: newMetadata },
    });
  }

  await tx.financialTransaction.create({
    data: {
      moduleSlug: booking.moduleSlug,
      type: "ONLINE_PAYMENT",
      bookingId: booking.id,
      totalAmount: payment.amount,
      cashAmount: 0,
      cardAmount: 0,
      performedById: "system",
      performedByName: "ЮKassa (онлайн)",
      description: payment.description,
      metadata: {
        paymentId: payment.id,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
      },
    },
  });
}

export async function afterBookingPaymentSucceeded(payment: Payment): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: payment.subjectId } });
  if (!booking) return;
  const resource = await prisma.resource.findUnique({
    where: { id: booking.resourceId },
    select: { name: true, googleCalendarId: true },
  });
  const times = bookingTimeStrings(booking);

  if (booking.moduleSlug === "gazebos" && booking.status === "CONFIRMED") {
    // Календарь — best-effort, как в ручном подтверждении.
    if (resource?.googleCalendarId && !booking.googleEventId) {
      const user = booking.userId
        ? await prisma.user.findUnique({
            where: { id: booking.userId },
            select: { name: true, phone: true },
          })
        : null;
      const calResult = await createCalendarEvent(resource.googleCalendarId, {
        summary: `${resource.name} — ${booking.clientName || user?.name || "Клиент"}`,
        description: `Телефон: ${booking.clientPhone || user?.phone || "не указан"} · Оплачено онлайн`,
        startTime: booking.startTime,
        endTime: booking.endTime,
      });
      if (calResult.success && calResult.eventId) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { googleEventId: calResult.eventId },
        });
      }
    }

    // Клиенту — «Бронирование подтверждено» (DM). Только gazebos: у ps-park
    // статус брони при оплате счёта не меняется.
    enqueueNotification({
      type: "booking.confirmed",
      moduleSlug: booking.moduleSlug,
      entityId: booking.id,
      userId: booking.userId ?? undefined,
      actor: "admin",
      data: { resourceName: resource?.name || "", ...times },
    });
  }

  // Канал-only событие «бронь оплачена» — для обоих модулей. Заменяет
  // premature booking.created в выделенном Telegram-канале: шлётся строго
  // после успешной онлайн-оплаты и несёт ссылку на бронь в админке
  // (adminUrl строится в renderChannelMessage по moduleSlug + bookingId).
  enqueueNotification({
    type: "booking.paid",
    moduleSlug: booking.moduleSlug,
    entityId: booking.id,
    userId: booking.userId ?? undefined,
    actor: "admin",
    data: {
      resourceName: resource?.name || "",
      ...times,
      clientName: booking.clientName || "",
      amount: Number(payment.amount).toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      bookingId: booking.id,
    },
  });
}

export async function onBookingPaymentCanceled(tx: Tx, payment: Payment): Promise<void> {
  const booking = await tx.booking.findUnique({ where: { id: payment.subjectId } });
  if (!booking) return;

  // Отменяем только неоплаченную PENDING-бронь беседки (слот освобождается).
  // Подтверждённые брони и счета ps-park отмена платежа не трогает.
  if (booking.moduleSlug === "gazebos" && booking.status === "PENDING") {
    await tx.booking.updateMany({
      where: { id: booking.id, status: "PENDING" },
      data: { status: "CANCELLED", cancelReason: "Оплата не завершена" },
    });
  }
}

export async function afterBookingPaymentCanceled(payment: Payment): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: payment.subjectId } });
  if (!booking || booking.status !== "CANCELLED") return;
  const resource = await prisma.resource.findUnique({
    where: { id: booking.resourceId },
    select: { name: true },
  });
  enqueueNotification({
    type: "booking.cancelled",
    moduleSlug: booking.moduleSlug,
    entityId: booking.id,
    userId: booking.userId ?? undefined,
    actor: "admin",
    data: { resourceName: resource?.name || "", ...bookingTimeStrings(booking) },
  });
}
