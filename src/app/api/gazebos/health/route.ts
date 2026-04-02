import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/gazebos/health — module health check
 */
export async function GET() {
  try {
    const [resourceCount, todayBookings] = await Promise.all([
      prisma.resource.count({ where: { moduleSlug: "gazebos", isActive: true } }),
      prisma.booking.count({
        where: {
          moduleSlug: "gazebos",
          date: { gte: new Date(new Date().toISOString().split("T")[0]) },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      }),
    ]);

    return NextResponse.json({
      module: "gazebos",
      status: "healthy",
      timestamp: new Date().toISOString(),
      metrics: {
        activeResources: resourceCount,
        todayBookings,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        module: "gazebos",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
