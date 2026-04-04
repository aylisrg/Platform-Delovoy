import { NextResponse } from "next/server";
import { checkTimewebHealth } from "@/modules/timeweb/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await checkTimewebHealth();

    return NextResponse.json({
      module: "timeweb",
      status: health.status,
      timestamp: new Date().toISOString(),
      metrics: {
        serverStatus: health.serverStatus ?? null,
      },
      ...(health.error && { error: health.error }),
    }, { status: health.status === "healthy" ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      module: "timeweb",
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503 });
  }
}
