import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { logAudit } from "@/lib/logger";
import { createBooking, BookingError } from "@/modules/gazebos/service";
import { createBooking as createPSBooking, PSBookingError } from "@/modules/ps-park/service";

/**
 * POST /api/webapp/book — create a booking from Telegram Mini App.
 * Protected by Mini App JWT.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const body = await request.json();
    const { moduleSlug, resourceId, date, startTime, endTime } = body;

    if (!moduleSlug || !resourceId || !date || !startTime || !endTime) {
      return apiValidationError("Не все поля заполнены");
    }

    let booking;
    if (moduleSlug === "gazebos") {
      booking = await createBooking(user.id, { resourceId, date, startTime, endTime });
    } else if (moduleSlug === "ps-park") {
      booking = await createPSBooking(user.id, { resourceId, date, startTime, endTime });
    } else {
      return apiError("INVALID_MODULE", `Модуль ${moduleSlug} не поддерживает бронирование`);
    }

    await logAudit(user.id, "booking.create", "Booking", booking.id, {
      source: "telegram_webapp",
      telegramId: user.telegramId,
      moduleSlug,
      resourceId,
      date,
      startTime,
      endTime,
    });

    return apiResponse(booking, undefined, 201);
  } catch (error) {
    if (error instanceof BookingError || error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    console.error("[WebApp API] Book error:", error);
    return apiServerError();
  }
}
