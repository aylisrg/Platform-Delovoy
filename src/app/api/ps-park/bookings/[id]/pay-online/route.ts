import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { getBooking, getBookingBill, PSBookingError } from "@/modules/ps-park/service";
import { createOnlinePayment } from "@/modules/payments/service";
import { PaymentError } from "@/modules/payments/types";

/**
 * POST /api/ps-park/bookings/:id/pay-online — платёжная ссылка ЮKassa на
 * остаток счёта сессии (третий способ оплаты рядом с наличными/картой/
 * абонементом). Менеджер показывает ссылку/QR гостю; после оплаты вебхук
 * зачисляет сумму в metadata.onlinePaidAmount, и гейт завершения её учитывает.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { id } = await params;
    const booking = await getBooking(id);
    if (!booking) return apiError("BOOKING_NOT_FOUND", "Бронирование не найдено", 404);
    if (booking.status !== "CONFIRMED" && booking.status !== "CHECKED_IN") {
      return apiError(
        "INVALID_STATUS",
        "Онлайн-оплата доступна только для активной сессии",
        409
      );
    }

    const bill = await getBookingBill(id);
    const metadata = (booking.metadata as Record<string, unknown> | null) ?? {};
    const onlinePaid = Number((metadata.onlinePaidAmount as string | undefined) ?? 0);
    const remaining = Math.round((bill.totalBill - onlinePaid) * 100) / 100;
    if (remaining <= 0) {
      return apiError("NOTHING_TO_PAY", "Счёт уже оплачен онлайн", 409);
    }

    const resource = await prisma.resource.findUnique({
      where: { id: booking.resourceId },
      select: { name: true },
    });
    const user = booking.userId
      ? await prisma.user.findUnique({
          where: { id: booking.userId },
          select: { email: true, phone: true },
        })
      : null;

    const payment = await createOnlinePayment({
      subjectType: "BOOKING",
      subjectId: booking.id,
      moduleSlug: "ps-park",
      amount: remaining,
      description: `Плей Парк: ${resource?.name ?? "сессия"} · счёт`,
      userId: booking.userId,
      createdById: session.user.id,
      customerEmail: user?.email ?? null,
      customerPhone: user?.phone ?? booking.clientPhone,
      receiptItems: [
        {
          description: `Игровая сессия: ${resource?.name ?? "Плей Парк"}`,
          amount: remaining,
        },
      ],
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/payments/{paymentId}`,
      metadata: { bookingId: booking.id, source: "ps-park-bill" },
    });

    await logAudit(session.user.id, "payment.link_created", "Booking", booking.id, {
      paymentId: payment.id,
      amount: remaining,
    });

    return apiResponse({
      paymentId: payment.id,
      confirmationUrl: payment.confirmationUrl,
      amount: remaining,
    });
  } catch (error) {
    if (error instanceof PaymentError) {
      return apiError(error.code, error.message, 400, error.metadata);
    }
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
