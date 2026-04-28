import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedis, redisState } = vi.hoisted(() => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  };
  return { mockRedis, redisState: { available: true } };
});

vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
  get redisAvailable() {
    return redisState.available;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

import { POST } from "../start/route";

function makeReq(ip = "203.0.113.10"): Request {
  return new Request("http://localhost/api/auth/telegram/start", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  }) as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.expire.mockResolvedValue(1);
  mockRedis.ttl.mockResolvedValue(60);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fake-bot-token");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "DelovoyPark_bot");
});

describe("POST /api/auth/telegram/start", () => {
  it("returns 503 when bot env is missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "");
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("TELEGRAM_BOT_NOT_CONFIGURED");
  });

  it("returns token + deeplink + expiresAt + pollIntervalMs on happy path", async () => {
    mockRedis.incr.mockResolvedValueOnce(1);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.token).toMatch(/^[A-Za-z0-9_-]{16,32}$/);
    expect(body.data.deepLink).toBe(
      `https://t.me/DelovoyPark_bot?start=auth_${body.data.token}`
    );
    expect(body.data.pollIntervalMs).toBe(2000);
    expect(typeof body.data.expiresAt).toBe("string");
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(
      Date.now()
    );
  });

  it("writes a PENDING entry to Redis with TTL 300", async () => {
    mockRedis.incr.mockResolvedValueOnce(1);
    await POST(makeReq() as never);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:tg:token:/),
      expect.stringContaining('"status":"PENDING"'),
      "EX",
      300
    );
  });

  it("rate-limits the 6th request from the same IP", async () => {
    mockRedis.incr.mockResolvedValueOnce(6);
    mockRedis.ttl.mockResolvedValueOnce(45);
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("does not crash when Redis is down — returns a token still", async () => {
    redisState.available = false;
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.token).toBeDefined();
  });
});
