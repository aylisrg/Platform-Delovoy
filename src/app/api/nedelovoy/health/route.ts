import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [officeCount, activeContracts, expiringContracts] = await Promise.all([
      prisma.office.count({ where: { parkSlug: "nedelovoy" } }),
      prisma.rentalContract.count({
        where: { parkSlug: "nedelovoy", status: "ACTIVE" },
      }),
      prisma.rentalContract.count({
        where: {
          parkSlug: "nedelovoy",
          status: { in: ["ACTIVE", "EXPIRING"] },
          endDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return NextResponse.json({
      module: "nedelovoy",
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
        module: "nedelovoy",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
