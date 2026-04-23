import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";

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
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const { bookingId } = await request.json();
    if (!bookingId) {
      return apiError("VALIDATION_ERROR", "bookingId is required", 400);
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId: user.id },
    });

    if (!booking) {
      return apiError("NOT_FOUND", "Бронирование не найдено", 404);
    }

    if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
      return apiError("INVALID_STATE", "Эту бронь нельзя отменить");
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    });

    return apiResponse({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error("[WebApp API] Cancel booking error:", error);
    return apiServerError();
  }
}
