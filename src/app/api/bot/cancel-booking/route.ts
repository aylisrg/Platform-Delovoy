import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyBotRequest } from "@/lib/bot-auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { cancelBooking, BookingError } from "@/modules/gazebos/service";
import { cancelBooking as cancelPSBooking, PSBookingError } from "@/modules/ps-park/service";

/**
 * POST /api/bot/cancel-booking — cancel a booking from Telegram bot.
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyBotRequest(request)) {
      return apiError("UNAUTHORIZED", "Invalid bot token", 401);
    }

    const body = await request.json();
    const { telegramId, bookingId } = body;

    if (!telegramId || !bookingId) {
      return apiError("VALIDATION_ERROR", "telegramId and bookingId are required", 400);
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
      select: { id: true },
    });

    if (!user) {
      return apiError("USER_NOT_FOUND", "Пользователь не найден", 404);
    }

    // Determine module from booking
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { moduleSlug: true, userId: true },
    });

    if (!booking) {
      return apiError("BOOKING_NOT_FOUND", "Бронирование не найдено", 404);
    }

    if (booking.userId !== user.id) {
      return apiError("FORBIDDEN", "Вы не можете отменить чужое бронирование", 403);
    }

    let cancelled;
    if (booking.moduleSlug === "gazebos") {
      cancelled = await cancelBooking(bookingId, user.id, "Отменено через Telegram бот");
    } else if (booking.moduleSlug === "ps-park") {
      cancelled = await cancelPSBooking(bookingId, user.id, "Отменено через Telegram бот");
    } else {
      return apiError("INVALID_MODULE", "Модуль не поддерживает отмену через бот");
    }

    await logAudit(user.id, "booking.cancel", "Booking", bookingId, {
      source: "telegram_bot",
      telegramId,
    });

    return apiResponse(cancelled);
  } catch (error) {
    if (error instanceof BookingError || error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    console.error("[Bot API] Cancel booking error:", error);
    return apiServerError();
  }
}
