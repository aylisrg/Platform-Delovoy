import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/logger";
import { createPrepaidBooking, PSBookingError } from "@/modules/ps-park/service";
import { createPSCheckoutSchema } from "@/modules/ps-park/validation";
import { OfferError } from "@/modules/booking/offer";
import { PaymentError } from "@/modules/payments/types";
import { getClientIp } from "@/lib/client-ip";
import { InventoryError } from "@/modules/inventory/service";
import { trackServerGoal } from "@/lib/metrika-server";
import { deriveSessionKeyFromHeaders } from "@/modules/analytics/product-events";
import { recordPSParkCheckoutAnalytics } from "@/modules/ps-park/checkout-analytics";

/**
 * POST /api/ps-park/book — create a new booking
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimit(request, "public");
    if (rateLimited) return rateLimited;
    const session = await auth();
    const body: unknown = await request.json().catch(() => null);
    const parsed = createPSCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const booking = await createPrepaidBooking(session?.user?.id ?? null, parsed.data, {
      ip: getClientIp(request), userAgent: request.headers.get("user-agent"),
    });

    await logAudit(session?.user?.id ?? "system", "booking.create", "Booking", booking.id, {
      resourceId: parsed.data.resourceId,
      date: parsed.data.date,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    });

    // Server-side трекинг в Я.Метрику — клиентский reachGoal блокируется AdBlock/ITP.
    // См. issue #225. Fire-and-forget, не блокирует ответ.
    trackServerGoal({
      request,
      target: "pspark_booking_success",
    });

    // First-party воронка (US-1 эпика #583, ADR 2026-09-16).
    recordPSParkCheckoutAnalytics({
      sessionKey: deriveSessionKeyFromHeaders(request.headers),
      bookingId: booking.id,
      paymentId: booking.payment.id,
    });

    return apiResponse(booking, undefined, 201);
  } catch (error) {
    if (error instanceof PSBookingError || error instanceof OfferError || error instanceof PaymentError) {
      return apiError(error.code, error.message);
    }
    if (error instanceof InventoryError) {
      return apiError(error.code, error.message, 400);
    }
    return apiServerError();
  }
}
