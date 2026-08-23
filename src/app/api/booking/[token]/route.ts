import { NextRequest } from "next/server";
import { z } from "zod";
import { apiResponse, apiError, apiNotFound, apiValidationError, apiServerError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/db";
import {
  buildBookingView,
  computeRefund,
  findBookingByToken,
  logTokenAction,
} from "@/modules/booking/manage";
import { DOCUMENT_KEYS, OfferError, buildAcceptance } from "@/modules/booking/offer";
import {
  cancelBooking,
  rescheduleBookingByClient,
  BookingError,
  createBookingPayment,
} from "@/modules/gazebos/service";

/**
 * Управление бронью по ссылке из письма (ТЗ §8).
 *
 * Без регистрации: единственный ключ — токен, сверяемый по SHA-256. Токен
 * невосстановим по номеру брони, поэтому «не найдено» отдаётся одинаково и на
 * несуществующий, и на чужой токен.
 */

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    /** Подтверждение, что клиент увидел расчёт удержаний. */
    confirmRefund: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("reschedule"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Формат даты: YYYY-MM-DD"),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Формат времени: HH:mm"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Формат времени: HH:mm"),
  }),
  z.object({
    action: z.literal("pay"),
    /** Акцепт для броней, оформленных оператором, ботом или Mini App. */
    acceptOffer: z.literal(true, {
      message: "Чтобы продолжить, подтвердите согласие с условиями оферты",
    }),
    offerVersionSlug: z.string().min(1).max(32),
    acceptMarketing: z.boolean().default(false),
  }),
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const limited = await rateLimit(request);
    if (limited) return limited;

    const { token } = await params;
    const booking = await findBookingByToken(token);
    if (!booking) return apiNotFound("Бронирование не найдено");

    return apiResponse(await buildBookingView(booking));
  } catch {
    return apiServerError();
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const limited = await rateLimit(request);
    if (limited) return limited;

    const { token } = await params;
    const booking = await findBookingByToken(token);
    if (!booking) return apiNotFound("Бронирование не найдено");

    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    switch (parsed.data.action) {
      case "cancel": {
        // Отмена доступна всегда и без объяснения причин. Расчёт удержаний
        // клиент видит на странице ДО нажатия — confirmRefund подтверждает,
        // что он его видел, а не создаёт ещё одно препятствие: без флага мы
        // отдаём тот же расчёт, чтобы страница его показала.
        const refund = computeRefund(booking);
        if (!parsed.data.confirmRefund && refund.deductions.length > 0) {
          return apiResponse({ confirmationRequired: true, refund });
        }

        const result = await cancelBooking(
          booking.id,
          booking.userId,
          "Отменено клиентом по ссылке из письма",
          true
        );
        await logTokenAction("отмена", booking, { refundAmount: refund.refundAmount });
        return apiResponse({ cancelled: result.penaltyRequired === false, refund });
      }

      case "reschedule": {
        const { booking: updated, priceDelta } = await rescheduleBookingByClient(booking.id, {
          date: parsed.data.date,
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
        });
        await logTokenAction("перенос", booking, {
          to: `${parsed.data.date} ${parsed.data.startTime}–${parsed.data.endTime}`,
          priceDelta,
        });
        return apiResponse(await buildBookingView(updated));
      }

      case "pay": {
        // Бронь, оформленная оператором/ботом, акцепта ещё не несёт. Оплата и
        // есть акцепт (п. 4.3 оферты), поэтому отметку клиент ставит здесь,
        // и только после неё выдаётся ссылка на оплату.
        if (booking.acceptedOfferAt) {
          return apiError("ALREADY_ACCEPTED", "Условия уже приняты по этой брони", 409);
        }
        if (booking.status !== "PENDING") {
          return apiError("INVALID_STATUS", "Эту бронь оплатить уже нельзя", 409);
        }

        let acceptance;
        try {
          acceptance = await buildAcceptance(DOCUMENT_KEYS.gazebosOffer, {
            offerVersionSlug: parsed.data.offerVersionSlug,
            acceptMarketing: parsed.data.acceptMarketing,
            ip: getClientIp(request),
            userAgent: request.headers.get("user-agent"),
          });
        } catch (err) {
          if (err instanceof OfferError) return apiError(err.code, err.message);
          throw err;
        }

        await prisma.booking.update({ where: { id: booking.id }, data: acceptance });
        const payment = await createBookingPayment(booking.id);
        await logTokenAction("акцепт и оплата", booking, { paymentId: payment?.id ?? null });

        return apiResponse({ confirmationUrl: payment?.confirmationUrl ?? null });
      }
    }
  } catch (error) {
    if (error instanceof BookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
