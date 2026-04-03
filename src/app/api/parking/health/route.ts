import { NextResponse } from "next/server";

/**
 * GET /api/parking/health — module health check
 */
export async function GET() {
  return NextResponse.json({
    module: "parking",
    status: "healthy",
    timestamp: new Date().toISOString(),
    metrics: {
      type: "informational",
    },
  });
}
