import { NextResponse } from "next/server";
import v8 from "node:v8";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { log } from "@/lib/logger";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

type HealthCheck = {
  status: HealthStatus;
  timestamp: string;
  checks: {
    database: { status: HealthStatus; latencyMs?: number; error?: string };
    redis: { status: HealthStatus; latencyMs?: number; error?: string };
    memory: { status: HealthStatus; usedPercent: number; rssBytes: number };
    eventLoop: { status: HealthStatus; delayMs: number };
  };
};

const CRITICAL_THROTTLE_KEY = "health:critical-logged";
const CRITICAL_THROTTLE_TTL = 300; // seconds

/**
 * Measure event-loop delay via setTimeout(0) drift. A busy loop can't service
 * the timer on time, so the observed delay grows above the scheduled 0ms.
 */
async function measureEventLoopDelay(): Promise<number> {
  const start = process.hrtime.bigint();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000; // ns → ms
}

/**
 * Log a CRITICAL SystemEvent at most once per throttle window. The window is
 * tracked in Redis; if Redis is unavailable we log anyway (no throttle) so a
 * genuine incident is never silently dropped.
 */
async function logCriticalThrottled(
  message: string,
  meta: Record<string, unknown>
): Promise<void> {
  let shouldLog = true;
  if (redisAvailable) {
    try {
      const already = await redis.get(CRITICAL_THROTTLE_KEY);
      if (already) {
        shouldLog = false;
      } else {
        await redis.set(CRITICAL_THROTTLE_KEY, "1", "EX", CRITICAL_THROTTLE_TTL);
      }
    } catch {
      // Redis error — fall through and log without throttle.
    }
  }
  if (shouldLog) {
    await log.critical("health", message, meta);
  }
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const checks: HealthCheck["checks"] = {
    database: { status: "unhealthy" },
    redis: { status: "unhealthy" },
    memory: { status: "unhealthy", usedPercent: 0, rssBytes: 0 },
    eventLoop: { status: "unhealthy", delayMs: 0 },
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
  if (!redisAvailable) {
    checks.redis = { status: "unhealthy", error: "Redis not connected" };
  } else {
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
  }

  // Check heap memory. Use V8 heap_size_limit (respects --max-old-space-size),
  // NOT os.totalmem which lies inside cgroups on a constrained VPS.
  const heap = v8.getHeapStatistics();
  const usedPercent =
    heap.heap_size_limit > 0
      ? Math.round((heap.used_heap_size / heap.heap_size_limit) * 100)
      : 0;
  const rssBytes = process.memoryUsage().rss;
  checks.memory = {
    status:
      usedPercent >= 95 ? "unhealthy" : usedPercent >= 85 ? "degraded" : "healthy",
    usedPercent,
    rssBytes,
  };

  // Check event-loop responsiveness.
  const delayMs = Math.round(await measureEventLoopDelay());
  checks.eventLoop = {
    status: delayMs >= 1000 ? "unhealthy" : delayMs >= 200 ? "degraded" : "healthy",
    delayMs,
  };

  // Status-code invariant: only db+redis both down yields 503. Memory / event
  // loop pressure MUST NOT flip the process into 503 (autoheal restart-loops).
  const dbDown = checks.database.status === "unhealthy";
  const redisDown = checks.redis.status === "unhealthy";
  const anyDegradedOrWorse = Object.values(checks).some(
    (c) => c.status !== "healthy"
  );

  const overallStatus: HealthStatus =
    dbDown && redisDown ? "unhealthy" : anyDegradedOrWorse ? "degraded" : "healthy";

  // Alert on any unhealthy check while the DB is reachable (so SystemEvent
  // write can succeed), throttled to avoid log storms.
  const anyUnhealthy = Object.values(checks).some((c) => c.status === "unhealthy");
  if (anyUnhealthy && !dbDown) {
    await logCriticalThrottled("Health check reported unhealthy component", {
      database: checks.database.status,
      redis: checks.redis.status,
      memory: checks.memory.status,
      eventLoop: checks.eventLoop.status,
      memoryUsedPercent: usedPercent,
      eventLoopDelayMs: delayMs,
    });
  }

  const response: HealthCheck = { status: overallStatus, timestamp, checks };
  const httpStatus = overallStatus === "unhealthy" ? 503 : 200;

  return NextResponse.json(response, { status: httpStatus });
}
