import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { logAudit } from "@/lib/logger";
import { cancelBooking as cancelGazeboBooking, BookingError } from "@/modules/gazebos/service";
import { cancelBooking as cancelPSBooking, PSBookingError } from "@/modules/ps-park/service";

/**
 * GET /api/webapp/bookings — get current user's bookings.
 * Protected by Mini App JWT.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const bookings = await prisma.booking.findMany({
      where: {
        userId: user.id,
        date: { gte: new Date(new Date().toISOString().split("T")[0]) },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 50,
    });

    // Enrich with resource names
    const resourceIds = [...new Set(bookings.map((b) => b.resourceId))];
    const resources = await prisma.resource.findMany({
      where: { id: { in: resourceIds } },
      select: { id: true, name: true },
    });
    const resourceMap = new Map(resources.map((r) => [r.id, r.name]));

    const enriched = bookings.map((b) => ({
      id: b.id,
      moduleSlug: b.moduleSlug,
      resourceName: resourceMap.get(b.resourceId) || "Ресурс",
      date: b.date.toISOString(),
      startTime: formatTime(b.startTime),
      endTime: formatTime(b.endTime),
      status: b.status,
    }));

    return apiResponse(enriched);
  } catch (error) {
    console.error("[WebApp API] Bookings error:", error);
    return apiServerError();
  }
}

/**
 * DELETE /api/webapp/bookings — cancel a booking.
 * Body: { bookingId: string, confirmPenalty?: boolean }
 *
 * Route = parse + dispatch to the owning module's cancelBooking() (#426) —
 * the old handler PATCHed status="CANCELLED" directly, bypassing the state
 * machine, cancellation-penalty policy, inventory return, Google Calendar
 * cleanup, notifications, and AuditLog that cancelBooking() owns.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const body: unknown = await request.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return apiError("VALIDATION_ERROR", "Некорректное тело запроса", 400);
    }
    const { bookingId, confirmPenalty } = body as Record<string, unknown>;
    if (typeof bookingId !== "string" || !bookingId) {
      return apiError("VALIDATION_ERROR", "bookingId is required", 400);
    }

    // Scoped by userId so a booking that isn't the caller's own reads as
    // "not found" rather than leaking that it exists.
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId: user.id },
      select: { moduleSlug: true },
    });
    if (!booking) {
      return apiError("NOT_FOUND", "Бронирование не найдено", 404);
    }

    let result;
    if (booking.moduleSlug === "gazebos") {
      result = await cancelGazeboBooking(bookingId, user.id, "Отменено через Mini App", confirmPenalty === true);
    } else if (booking.moduleSlug === "ps-park") {
      result = await cancelPSBooking(bookingId, user.id, "Отменено через Mini App", confirmPenalty === true);
    } else {
      return apiError("INVALID_MODULE", "Модуль не поддерживает отмену через Mini App", 400);
    }

    if (result.penaltyRequired) {
      return apiError(
        "PENALTY_CONFIRMATION_REQUIRED",
        "Отмена позже допустимого срока требует подтверждения штрафа",
        402,
        { penaltyAmount: result.penaltyAmount, basePrice: result.basePrice }
      );
    }

    await logAudit(user.id, "booking.cancel", "Booking", bookingId, { source: "webapp" });

    return apiResponse({ id: result.booking.id, status: result.booking.status });
  } catch (error) {
    if (error instanceof BookingError || error instanceof PSBookingError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "BOOKING_NOT_FOUND" ? 404 : 409;
      return apiError(error.code, error.message, status);
    }
    console.error("[WebApp API] Cancel booking error:", error);
    return apiServerError();
  }
}
