import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/cafe/health — module health check
 */
export async function GET() {
  try {
    const [menuCount, todayOrders] = await Promise.all([
      prisma.menuItem.count({ where: { moduleSlug: "cafe", isAvailable: true } }),
      prisma.order.count({
        where: {
          moduleSlug: "cafe",
          createdAt: { gte: new Date(new Date().toISOString().split("T")[0]) },
        },
      }),
    ]);

    return NextResponse.json({
      module: "cafe",
      status: "healthy",
      timestamp: new Date().toISOString(),
      metrics: {
        activeMenuItems: menuCount,
        todayOrders,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        module: "cafe",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
