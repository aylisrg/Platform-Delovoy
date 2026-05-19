import { NextResponse } from "next/server";
import { getHealthMetrics } from "@/modules/messenger/service";

export async function GET() {
  try {
    const { chatCount, messageCount } = await getHealthMetrics();
    return NextResponse.json({
      module: "messenger",
      status: "healthy",
      timestamp: new Date().toISOString(),
      metrics: { chatCount, messageCount },
    });
  } catch (error) {
    return NextResponse.json(
      {
        module: "messenger",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 },
    );
  }
}
