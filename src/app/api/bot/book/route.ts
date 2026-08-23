import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError } from "@/lib/api-response";
import { verifyBotRequest } from "@/lib/bot-auth";
import { prisma } from "@/lib/db";
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
 * POST /api/bot/book — create a booking from Telegram bot.
 * Identifies user by telegramId (creates account if needed).
 * Protected by bot token header.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify bot token
    if (!verifyBotRequest(request)) {
      return apiError("UNAUTHORIZED", "Invalid bot token", 401);
    }

    const body = await request.json();
    const { telegramId, moduleSlug, resourceId, date, startTime, endTime, telegramUser } = body;

    if (!telegramId || !moduleSlug || !resourceId || !date || !startTime || !endTime) {
      return apiValidationError("Не все поля заполнены");
    }

    // Find or create user by telegramId
    let user = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
    });

    if (!user) {
      const name = telegramUser
        ? [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ") || telegramUser.username || "Telegram User"
        : "Telegram User";

      user = await prisma.user.create({
        data: {
          telegramId: String(telegramId),
          name,
          role: "USER",
        },
      });
    }

    const bookingInput = { resourceId, date, startTime, endTime };

    let booking;
    let manageUrl: string | null = null;
    if (moduleSlug === "gazebos") {
      const created = await createBooking(user.id, bookingInput);
      const { manageToken, ...rest } = created;
      booking = rest;
      manageUrl = manageToken ? manageBookingUrl(manageToken) : null;
    } else if (moduleSlug === "ps-park") {
      booking = await createPSBooking(user.id, bookingInput);
    } else {
      return apiError("INVALID_MODULE", `Модуль ${moduleSlug} не поддерживает бронирование`);
    }

    await logAudit(user.id, "booking.create", "Booking", booking.id, {
      source: "telegram_bot",
      telegramId,
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
    console.error("[Bot API] Book error:", error);
    return apiServerError();
  }
}

