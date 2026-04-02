import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

type HealthCheck = {
  status: HealthStatus;
  timestamp: string;
  checks: {
    database: { status: HealthStatus; latencyMs?: number; error?: string };
    redis: { status: HealthStatus; latencyMs?: number; error?: string };
  };
};

export async function GET() {
  const timestamp = new Date().toISOString();
  const checks: HealthCheck["checks"] = {
    database: { status: "unhealthy" },
    redis: { status: "unhealthy" },
  };

  // Check PostgreSQL
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Check Redis
  try {
    const redisStart = Date.now();
    await redis.ping();
    checks.redis = { status: "healthy", latencyMs: Date.now() - redisStart };
  } catch (error) {
    checks.redis = {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === "healthy");
  const allUnhealthy = Object.values(checks).every((c) => c.status === "unhealthy");

  const overallStatus: HealthStatus = allHealthy
    ? "healthy"
    : allUnhealthy
      ? "unhealthy"
      : "degraded";

  const response: HealthCheck = { status: overallStatus, timestamp, checks };
  const httpStatus = overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
}
