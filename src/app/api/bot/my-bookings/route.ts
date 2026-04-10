import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";

/**
 * GET /api/bot/my-bookings?telegramId=xxx
 * Returns active bookings for a Telegram user.
 */
export async function GET(request: NextRequest) {
  try {
    const telegramId = request.nextUrl.searchParams.get("telegramId");
    if (!telegramId) {
      return apiError("VALIDATION_ERROR", "telegramId is required", 400);
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
      select: { id: true },
    });

    if (!user) {
      // Not an error — user just hasn't booked yet
      return apiResponse([]);
    }

    const bookings = await prisma.booking.findMany({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        date: { gte: new Date(new Date().toISOString().split("T")[0]) },
      },
      orderBy: { date: "asc" },
      take: 20,
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
      startTime: b.startTime.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      endTime: b.endTime.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: b.status,
    }));

    return apiResponse(enriched);
  } catch (error) {
    console.error("[Bot API] My bookings error:", error);
    return apiServerError();
  }
}
