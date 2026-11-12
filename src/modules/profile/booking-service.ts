import type { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import {
  buildBookingView,
  computeRefund,
  BookingManageError,
} from "@/modules/booking/manage";
import { getBookingPaymentSummary } from "@/modules/booking/payment-status";
import { buildAcceptance, DOCUMENT_KEYS } from "@/modules/booking/offer";
import {
  cancelBooking,
  createBookingPayment,
  rescheduleBookingByClient,
} from "@/modules/gazebos/service";
import { cancelBooking as cancelPSBooking } from "@/modules/ps-park/service";
import { isPSParkReservation } from "@/modules/booking/payment-flow";
import { ownBookingActionSchema } from "./validation";

export async function findOwnBooking(userId: string, id: string) {
  const booking = await prisma.booking.findFirst({
    where: {
      id,
      userId,
      deletedAt: null,
      moduleSlug: { in: ["gazebos", "ps-park"] },
    },
  });
  if (!booking)
    throw new BookingManageError("NOT_FOUND", "Бронирование не найдено", 404);
  return booking;
}

export async function getOwnBooking(userId: string, id: string) {
  const booking = await findOwnBooking(userId, id);
  const [view, payment] = await Promise.all([
    buildBookingView(booking),
    prisma.payment.findFirst({
      where: {
        subjectType: "BOOKING",
        subjectId: id,
        status: "PENDING",
        isTest: false,
      },
      orderBy: { createdAt: "desc" },
      select: { confirmationUrl: true, expiresAt: true, amount: true },
    }),
  ]);
  const summary = getBookingPaymentSummary(booking);
  const metadata = booking.metadata as Record<string, unknown> | null;
  const canPay =
    booking.status === "PENDING" &&
    booking.startTime > new Date() &&
    summary.paid === 0 &&
    summary.outstanding > 0 &&
    Math.abs(Number(metadata?.totalPrice ?? 0) - summary.totalDue) < 0.01;
  const liveUrl =
    booking.acceptedOfferAt &&
    booking.status === "PENDING" &&
    booking.startTime > new Date() &&
    summary.outstanding > 0 &&
    payment?.confirmationUrl &&
    (!payment.expiresAt || payment.expiresAt > new Date()) &&
    Math.abs(Number(payment.amount) - summary.outstanding) < 0.01
      ? payment.confirmationUrl
      : null;
  return {
    moduleSlug: booking.moduleSlug,
    payment: summary,
    canPay,
    canCancel:
      ["PENDING", "CONFIRMED"].includes(booking.status) &&
      !isPSParkReservation(booking),
    view: {
      ...view,
      guestName: null,
      totalPrice: summary.totalDue,
      paidAmount: summary.paid,
      paymentUrl: liveUrl,
      acceptanceRequired:
        booking.moduleSlug === "gazebos" && !booking.acceptedOfferAt && canPay,
    },
  };
}

export async function actOnOwnBooking(
  userId: string,
  id: string,
  input: z.infer<typeof ownBookingActionSchema>,
  context: { ip: string; userAgent: string | null },
) {
  const booking = await findOwnBooking(userId, id);
  if (!["PENDING", "CONFIRMED"].includes(booking.status))
    throw new BookingManageError(
      "INVALID_STATUS",
      "Действие недоступно для этой брони",
      409,
    );
  if (input.action === "cancel") {
    if (booking.moduleSlug === "gazebos") {
      const refund = computeRefund(booking);
      // Existing service remains authoritative for both prepaid and legacy penalties.
      const result = await cancelBooking(
        id,
        userId,
        "Отменено клиентом в личном кабинете",
        input.confirmRefund,
      );
      if (result.penaltyRequired)
        return {
          confirmationRequired: true,
          refund,
          penaltyAmount: result.penaltyAmount,
        };
      await logAudit(userId, "booking.customer_cancel", "Booking", id);
      return { cancelled: true, refund };
    }
    const result = await cancelPSBooking(
      id,
      userId,
      "Отменено клиентом в личном кабинете",
      input.confirmRefund,
    );
    if (result.penaltyRequired)
      return {
        confirmationRequired: true,
        penaltyAmount: result.penaltyAmount,
      };
    await logAudit(userId, "booking.customer_cancel", "Booking", id);
    return { cancelled: true };
  }
  if (booking.moduleSlug !== "gazebos")
    throw new BookingManageError(
      "ACTION_UNAVAILABLE",
      "Для изменения этой брони свяжитесь с администратором",
      409,
    );
  if (input.action === "reschedule") {
    await rescheduleBookingByClient(id, input);
    await logAudit(userId, "booking.customer_reschedule", "Booking", id);
    return (await getOwnBooking(userId, id)).view;
  }
  const summary = getBookingPaymentSummary(booking);
  const metadata = booking.metadata as Record<string, unknown> | null;
  if (
    booking.status !== "PENDING" ||
    booking.startTime <= new Date() ||
    summary.paid > 0 ||
    summary.outstanding <= 0 ||
    Math.abs(Number(metadata?.totalPrice ?? 0) - summary.totalDue) >= 0.01
  )
    throw new BookingManageError(
      "PAYMENT_UNAVAILABLE",
      "По этой брони нужна проверка оплаты администратором",
      409,
    );
  if (!booking.acceptedOfferAt) {
    const acceptance = await buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
      offerVersionSlug: input.offerVersionSlug,
      acceptMarketing: input.acceptMarketing,
      ...context,
    });
    await prisma.booking.update({ where: { id }, data: acceptance });
    await logAudit(userId, "booking.customer_acceptance", "Booking", id);
  }
  const payment = await createBookingPayment(id);
  if (!payment?.confirmationUrl)
    throw new BookingManageError(
      "PAYMENT_UNAVAILABLE",
      "Онлайн-оплата сейчас недоступна. Попробуйте позже или свяжитесь с парком",
      503,
    );
  await logAudit(userId, "booking.customer_payment_link", "Booking", id);
  return { confirmationUrl: payment.confirmationUrl };
}
