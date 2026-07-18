import { describe, it, expect, vi, beforeEach } from "vitest";
import v8 from "node:v8";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    ping: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
  redisAvailable: true,
}));

vi.mock("@/lib/logger", () => ({
  log: {
    critical: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET } from "../route";
import { prisma } from "@/lib/db";
import * as redisModule from "@/lib/redis";
import { redis } from "@/lib/redis";
import { log } from "@/lib/logger";

function setRedisAvailable(value: boolean) {
  (redisModule as { redisAvailable: boolean }).redisAvailable = value;
}

/** Heap stats that map to a healthy memory check (~30% used). */
function healthyHeap(usedPercent = 30) {
  const limit = 1_000_000_000;
  return {
    used_heap_size: Math.round((usedPercent / 100) * limit),
    heap_size_limit: limit,
  } as ReturnType<typeof v8.getHeapStatistics>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setRedisAvailable(true);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
  vi.mocked(redis.ping).mockResolvedValue("PONG");
  vi.mocked(redis.get).mockResolvedValue(null);
  vi.mocked(redis.set).mockResolvedValue("OK");
  vi.spyOn(v8, "getHeapStatistics").mockReturnValue(healthyHeap());
});

describe("GET /api/health", () => {
  it("returns 200 and status healthy when everything is up", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.database.status).toBe("healthy");
    expect(body.checks.redis.status).toBe("healthy");
    expect(body.checks.memory.status).toBe("healthy");
    expect(body.checks.eventLoop.status).toBe("healthy");
    expect(typeof body.checks.memory.rssBytes).toBe("number");
    expect(log.critical).not.toHaveBeenCalled();
  });

  it("returns 503 and status unhealthy when both DB and Redis are down", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("db down"));
    setRedisAvailable(false);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    // DB unreachable → no CRITICAL log attempt (SystemEvent write would fail).
    expect(log.critical).not.toHaveBeenCalled();
  });

  it("returns 200 and status degraded when memory is degraded, never 503", async () => {
    vi.spyOn(v8, "getHeapStatistics").mockReturnValue(healthyHeap(88));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.memory.status).toBe("degraded");
    expect(body.checks.memory.usedPercent).toBe(88);
    // Degraded is not unhealthy → no CRITICAL log.
    expect(log.critical).not.toHaveBeenCalled();
  });

  it("stays 200 even when memory is unhealthy (>=95%) with DB up", async () => {
    vi.spyOn(v8, "getHeapStatistics").mockReturnValue(healthyHeap(97));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.memory.status).toBe("unhealthy");
  });

  it("logs CRITICAL once when an unhealthy check occurs with DB reachable", async () => {
    vi.spyOn(v8, "getHeapStatistics").mockReturnValue(healthyHeap(97));

    await GET();

    expect(log.critical).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledWith("health:critical-logged");
    expect(redis.set).toHaveBeenCalledWith(
      "health:critical-logged",
      "1",
      "EX",
      300
    );
  });

  it("throttles CRITICAL log when throttle key already exists", async () => {
    vi.spyOn(v8, "getHeapStatistics").mockReturnValue(healthyHeap(97));
    vi.mocked(redis.get).mockResolvedValue("1");

    await GET();

    expect(log.critical).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("logs CRITICAL without throttle when Redis is unavailable", async () => {
    setRedisAvailable(false);
    vi.spyOn(v8, "getHeapStatistics").mockReturnValue(healthyHeap(97));

    await GET();

    expect(log.critical).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
  });
});
