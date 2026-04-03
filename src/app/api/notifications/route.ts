import { NextRequest } from "next/server";
import { apiResponse, apiServerError, apiUnauthorized } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { prisma } from "@/lib/db";

/**
 * GET /api/notifications — get upcoming bookings that need reminders
 * Admin-only endpoint for monitoring notification state.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || !hasRole(session.user, "MANAGER")) {
      return apiUnauthorized();
    }

    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    // Find bookings starting in the next hour that are confirmed
    const upcomingBookings = await prisma.booking.findMany({
      where: {
        status: "CONFIRMED",
        startTime: {
          gte: now,
          lte: oneHourLater,
        },
      },
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { startTime: "asc" },
    });

    const moduleParam = request.nextUrl.searchParams.get("module");
    const filtered = moduleParam
      ? upcomingBookings.filter((b) => b.moduleSlug === moduleParam)
      : upcomingBookings;

    return apiResponse(filtered, { total: filtered.length });
  } catch {
    return apiServerError();
  }
}
