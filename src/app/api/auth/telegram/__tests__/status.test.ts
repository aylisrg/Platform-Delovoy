import { describe, it, expect, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

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

import { GET } from "../status/route";
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_TYPE,
} from "@/modules/auth/telegram-token-jwt";

function makeReq(token: string | null, ip = "203.0.113.10"): Request {
  const url = new URL("http://localhost/api/auth/telegram/status");
  if (token !== null) url.searchParams.set("token", token);
  return new Request(url.toString(), {
    method: "GET",
    headers: { "x-forwarded-for": ip },
  }) as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
  mockRedis.set.mockResolvedValue("OK");
  mockRedis.expire.mockResolvedValue(1);
  mockRedis.ttl.mockResolvedValue(60);
  mockRedis.incr.mockResolvedValue(1);
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-please-replace");
});

describe("GET /api/auth/telegram/status", () => {
  it("returns 400 when token query param is missing", async () => {
    const res = await GET(makeReq(null) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns expired when Redis has no entry for token", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    const res = await GET(makeReq("missing-tok") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("expired");
  });

  it("returns pending when Redis entry says PENDING", async () => {
    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({
        status: "PENDING",
        createdAt: new Date().toISOString(),
      })
    );
    const res = await GET(makeReq("pending-tok") as never);
    const body = await res.json();
    expect(body.data.status).toBe("pending");
  });

  it("returns consumed when Redis entry says CONSUMED", async () => {
    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({
        status: "CONSUMED",
        createdAt: new Date().toISOString(),
        userId: "u-1",
      })
    );
    const res = await GET(makeReq("consumed-tok") as never);
    const body = await res.json();
    expect(body.data.status).toBe("consumed");
  });

  it("mints a verifiable JWT one-time code on CONFIRMED → CONSUMED transition", async () => {
    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          userId: "user-confirmed-1",
        })
      )
      // consumeConfirmedToken re-reads
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          userId: "user-confirmed-1",
        })
      );

    const res = await GET(makeReq("confirmed-tok") as never);
    const body = await res.json();
    expect(body.data.status).toBe("confirmed");
    expect(body.data.oneTimeCode).toBeTruthy();

    const { payload } = await jwtVerify(
      body.data.oneTimeCode,
      new TextEncoder().encode("test-secret-please-replace"),
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    expect(payload.sub).toBe("user-confirmed-1");
    expect(payload.type).toBe(JWT_TYPE);
    expect(payload.jti).toBeTruthy();
  });

  it("flips Redis status to CONSUMED after minting", async () => {
    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          userId: "user-x",
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          userId: "user-x",
        })
      );

    await GET(makeReq("transition-tok") as never);

    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:tg:token:transition-tok$/),
      expect.stringContaining('"status":"CONSUMED"'),
      "EX",
      30
    );
  });

  it("rate-limits the 31st status poll for the same token+IP", async () => {
    mockRedis.incr.mockResolvedValueOnce(31);
    mockRedis.ttl.mockResolvedValueOnce(40);
    const res = await GET(makeReq("any-tok") as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("returns 503 when NEXTAUTH_SECRET is missing on CONFIRMED transition", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          userId: "user-y",
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          status: "CONFIRMED",
          createdAt: new Date().toISOString(),
          userId: "user-y",
        })
      );

    const res = await GET(makeReq("misconf-tok") as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
