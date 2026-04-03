import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/rental/health — module health check
 */
export async function GET() {
  try {
    const [officeCount, activeContracts, expiringContracts] = await Promise.all([
      prisma.office.count(),
      prisma.rentalContract.count({ where: { status: "ACTIVE" } }),
      prisma.rentalContract.count({
        where: {
          status: { in: ["ACTIVE", "EXPIRING"] },
          endDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return NextResponse.json({
      module: "rental",
      status: "healthy",
      timestamp: new Date().toISOString(),
      metrics: {
        totalOffices: officeCount,
        activeContracts,
        expiringContracts,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        module: "rental",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
