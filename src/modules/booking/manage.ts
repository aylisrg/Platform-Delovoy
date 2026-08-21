import type { Booking } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { hashManageToken, bookingNumber } from "./offer";
import { PREPAID_CANCELLATION_POLICY } from "./types";
import { computeCancellationPenalty } from "./cancellation";
import { RESCHEDULE_WINDOW_DAYS } from "./cancellation-summary";
import type { BookingMetadata } from "./types";

/**
 * Самостоятельное управление бронью по ссылке из письма (ТЗ §8).
 *
 * Страница живёт без регистрации: единственный ключ — токен из письма. Право
 * на отказ от договора безусловное, поэтому отмена доступна всегда и в один-два
 * клика — любое трение здесь это риск по пп. 3 п. 2 ст. 16 ЗоЗПП.
 */

export class BookingManageError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "BookingManageError";
  }
}

/**
 * Ищет бронь по сырому токену.
 *
 * Поиск идёт по хешу, а не по самому токену: в БД сырого значения нет.
 * Несуществующий и чужой токен неразличимы — оба дают «не найдено».
 */
export async function findBookingByToken(token: string): Promise<Booking | null> {
  if (!token || token.length < 16) return null;
  return prisma.booking.findFirst({
    where: { manageTokenHash: hashManageToken(token), deletedAt: null },
  });
}

export type RefundBreakdown = {
  /** Сколько клиент заплатил онлайн. */
  paidAmount: number;
  /** Сколько вернётся. */
  refundAmount: number;
  /** Что и почему удерживается — построчно, для показа ДО подтверждения. */
  deductions: { label: string; amount: number }[];
  /** Часов до начала на момент расчёта. */
  hoursUntilStart: number;
};

/**
 * Расчёт возврата при отмене — тем же кодом, что и сама отмена.
 *
 * Показывается клиенту ДО нажатия «Отменить»: он должен видеть сумму и
 * расшифровку удержаний, а не узнавать о них из выписки (ТЗ §8).
 */
export function computeRefund(booking: Booking, now: Date = new Date()): RefundBreakdown {
  const metadata = (booking.metadata as BookingMetadata | null) ?? {};
  const paidAmount = Number(metadata.onlinePaidAmount ?? 0);
  const hoursUntilStart = (booking.startTime.getTime() - now.getTime()) / 3_600_000;

  if (paidAmount <= 0) {
    return { paidAmount: 0, refundAmount: 0, deductions: [], hoursUntilStart };
  }

  const result = computeCancellationPenalty(
    booking.startTime,
    now,
    paidAmount,
    PREPAID_CANCELLATION_POLICY,
    false
  );

  if (!result.penaltyApplied) {
    return { paidAmount, refundAmount: paidAmount, deductions: [], hoursUntilStart };
  }

  return {
    paidAmount,
    refundAmount: Math.max(0, paidAmount - result.penaltyAmount),
    deductions: [
      {
        label: `Стоимость аренды при отмене менее чем за ${PREPAID_CANCELLATION_POLICY.thresholdHours} ч до начала`,
        amount: result.penaltyAmount,
      },
    ],
    hoursUntilStart,
  };
}

export type RescheduleEligibility =
  | { allowed: true; windowEndsAt: Date }
  | { allowed: false; reason: string };

/**
 * Можно ли перенести бронь самостоятельно (п. 7.7 оферты).
 *
 * Три условия: запас больше порога, дата в пределах окна и право переноса ещё
 * не израсходовано. Второй перенос — через оператора, как и обещано клиенту.
 */
export function checkRescheduleEligibility(
  booking: Booking,
  now: Date = new Date()
): RescheduleEligibility {
  const thresholdHours = PREPAID_CANCELLATION_POLICY.thresholdHours;
  const hoursUntilStart = (booking.startTime.getTime() - now.getTime()) / 3_600_000;

  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    return { allowed: false, reason: "Эту бронь уже нельзя перенести" };
  }

  if (hoursUntilStart < thresholdHours) {
    return {
      allowed: false,
      reason: `Перенести бронь можно не позднее чем за ${thresholdHours} ч до начала. Позвоните нам — поищем варианты.`,
    };
  }

  const metadata = (booking.metadata as BookingMetadata | null) ?? {};
  const used = Number((metadata as Record<string, unknown>).clientRescheduleCount ?? 0);
  if (used >= 1) {
    return {
      allowed: false,
      reason: "Бесплатный перенос уже использован. Следующий — через оператора.",
    };
  }

  // Окно отсчитывается от даты первоначального бронирования (п. 7.7 оферты).
  const windowEndsAt = new Date(booking.date);
  windowEndsAt.setDate(windowEndsAt.getDate() + RESCHEDULE_WINDOW_DAYS);

  return { allowed: true, windowEndsAt };
}

/** Публичное представление брони для страницы управления. */
export type ManagedBookingView = {
  number: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: Booking["status"];
  guestName: string | null;
  totalPrice: number;
  paidAmount: number;
  items: { name: string; quantity: number; price: number }[];
  offer: { slug: string; number: number } | null;
  refund: RefundBreakdown;
  reschedule: RescheduleEligibility;
  /** Ссылка на незавершённую оплату, если бронь ещё ждёт денег. */
  paymentUrl: string | null;
  /** Нужен ли акцепт перед оплатой (бронь оформлена оператором/ботом). */
  acceptanceRequired: boolean;
};

export async function buildBookingView(booking: Booking): Promise<ManagedBookingView> {
  const metadata = (booking.metadata as BookingMetadata | null) ?? {};
  const [resource, offerVersion, payment] = await Promise.all([
    prisma.resource.findUnique({
      where: { id: booking.resourceId },
      select: { name: true },
    }),
    booking.offerVersionId
      ? prisma.offerVersion.findUnique({
          where: { id: booking.offerVersionId },
          select: { slug: true, number: true },
        })
      : Promise.resolve(null),
    prisma.payment.findFirst({
      where: { subjectType: "BOOKING", subjectId: booking.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { confirmationUrl: true, expiresAt: true },
    }),
  ]);

  const items = ((metadata.items ?? []) as { name?: string; quantity?: number; price?: string | number }[])
    .map((item) => ({
      name: String(item.name ?? "Позиция"),
      quantity: Number(item.quantity ?? 0),
      price: Number(item.price ?? 0),
    }));

  const paymentLive =
    payment?.confirmationUrl && (!payment.expiresAt || payment.expiresAt > new Date())
      ? payment.confirmationUrl
      : null;

  return {
    number: bookingNumber(booking.id),
    resourceName: resource?.name ?? "Беседка",
    date: booking.date.toISOString().split("T")[0],
    startTime: formatTime(booking.startTime),
    endTime: formatTime(booking.endTime),
    status: booking.status,
    guestName: booking.clientName,
    totalPrice: Number(metadata.totalPrice ?? 0),
    paidAmount: Number(metadata.onlinePaidAmount ?? 0),
    items,
    offer: offerVersion,
    refund: computeRefund(booking),
    reschedule: checkRescheduleEligibility(booking),
    paymentUrl: paymentLive,
    // Бронь без акцепта (оператор по телефону, бот, Mini App) не может быть
    // оплачена, пока клиент сам не подтвердит согласие с условиями.
    acceptanceRequired: booking.acceptedOfferAt === null,
  };
}

/** Фиксирует использованный бесплатный перенос. */
export function markRescheduleUsed(metadata: BookingMetadata | null): Record<string, unknown> {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  return {
    ...meta,
    clientRescheduleCount: Number(meta.clientRescheduleCount ?? 0) + 1,
    lastClientRescheduleAt: new Date().toISOString(),
  };
}

/** Служебный лог доступа по токену — гостевые действия в AuditLog не попадают. */
export async function logTokenAction(
  action: string,
  booking: Booking,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await log.info(EVENT_SOURCES.GAZEBOS, `Управление бронью: ${action}`, {
    bookingId: booking.id,
    bookingNumber: bookingNumber(booking.id),
    ...extra,
  });
}
