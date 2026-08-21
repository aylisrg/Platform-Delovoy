import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { logAudit } from "@/lib/logger";
import { createBooking, BookingError } from "@/modules/gazebos/service";
import { createBooking as createPSBooking, PSBookingError } from "@/modules/ps-park/service";

/**
 * Ссылка на страницу управления бронью.
 *
 * Бот и Mini App своего экрана акцепта не имеют, поэтому бронь оттуда
 * заводится без акцепта и без ссылки на оплату. Оплатить её клиент может на
 * этой странице — там показаны сводка, условия отмены и отметка о согласии
 * с офертой (тот же порядок, что для брони по телефону, ТЗ §5.4).
 */
function manageBookingUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/booking/${token}`;
}

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
    let manageUrl: string | null = null;
    if (moduleSlug === "gazebos") {
      const created = await createBooking(user.id, { resourceId, date, startTime, endTime });
      const { manageToken, ...rest } = created;
      booking = rest;
      manageUrl = manageToken ? manageBookingUrl(manageToken) : null;
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

    return apiResponse({ ...booking, manageUrl }, undefined, 201);
  } catch (error) {
    if (error instanceof BookingError || error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    console.error("[WebApp API] Book error:", error);
    return apiServerError();
  }
}
