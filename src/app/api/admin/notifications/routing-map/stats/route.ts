import { auth } from "@/lib/auth";
import {
  apiResponse,
  requireAdminSection,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/notifications/routing-map/stats
 * Returns notification send statistics for the last 24 hours.
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Aggregate by event type
    const byEvent = await prisma.notificationLog.groupBy({
      by: ["eventType", "status"],
      where: { createdAt: { gte: since } },
      _count: true,
    });

    // Aggregate by channel
    const byChannel = await prisma.notificationLog.groupBy({
      by: ["channel", "status"],
      where: { createdAt: { gte: since } },
      _count: true,
    });

    // Build response
    const eventStats: Record<
      string,
      { sent: number; failed: number; skipped: number }
    > = {};
    for (const row of byEvent) {
      if (!eventStats[row.eventType]) {
        eventStats[row.eventType] = { sent: 0, failed: 0, skipped: 0 };
      }
      if (row.status === "SENT") eventStats[row.eventType].sent += row._count;
      else if (row.status === "FAILED")
        eventStats[row.eventType].failed += row._count;
      else if (row.status === "SKIPPED")
        eventStats[row.eventType].skipped += row._count;
    }

    const channelStats: Record<string, { sent: number; failed: number }> = {};
    let totalSent = 0;
    let totalFailed = 0;
    for (const row of byChannel) {
      if (!channelStats[row.channel]) {
        channelStats[row.channel] = { sent: 0, failed: 0 };
      }
      if (row.status === "SENT") {
        channelStats[row.channel].sent += row._count;
        totalSent += row._count;
      } else if (row.status === "FAILED") {
        channelStats[row.channel].failed += row._count;
        totalFailed += row._count;
      }
    }

    return apiResponse({
      period: "24h",
      byEvent: eventStats,
      byChannel: channelStats,
      totalSent,
      totalFailed,
    });
  } catch (error) {
    console.error("[RoutingMap Stats] Error:", error);
    return apiServerError();
  }
}
