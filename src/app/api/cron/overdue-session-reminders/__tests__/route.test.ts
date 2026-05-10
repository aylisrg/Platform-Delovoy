import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/booking/overdue-reminders", () => ({
  scanAndDispatchOverdue: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));

import { scanAndDispatchOverdue } from "@/modules/booking/overdue-reminders";
import { rateLimit } from "@/lib/rate-limit";
import { GET } from "../route";

const mockedScan = vi.mocked(scanAndDispatchOverdue);
const mockedRateLimit = vi.mocked(rateLimit);

function makeReq(token: string | null): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/overdue-session-reminders"
      : `http://localhost/api/cron/overdue-session-reminders?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.WEB_PUSH_ENABLED = "true";
  mockedRateLimit.mockResolvedValue(null);
  mockedScan.mockResolvedValue({
    scanned: 0,
    dispatched: 0,
    escalated: 0,
    deduped: 0,
    skippedNoChannel: 0,
  });
});

describe("GET /api/cron/overdue-session-reminders", () => {
  it("returns 503 when WEB_PUSH_ENABLED is not 'true'", async () => {
    process.env.WEB_PUSH_ENABLED = "false";
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("WEB_PUSH_DISABLED");
    expect(mockedScan).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq("anything"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(mockedScan).not.toHaveBeenCalled();
  });

  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedScan).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedScan).not.toHaveBeenCalled();
  });

  it("happy path: invokes scanAndDispatchOverdue and returns counters", async () => {
    mockedScan.mockResolvedValue({
      scanned: 3,
      dispatched: 4,
      escalated: 1,
      deduped: 2,
      skippedNoChannel: 0,
    });
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedScan).toHaveBeenCalledTimes(1);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      scanned: 3,
      dispatched: 4,
      escalated: 1,
      deduped: 2,
      skippedNoChannel: 0,
    });
  });

  it("returns rate-limit response when limiter trips", async () => {
    const { NextResponse } = await import("next/server");
    mockedRateLimit.mockResolvedValueOnce(
      NextResponse.json(
        {
          success: false,
          error: { code: "RATE_LIMIT_EXCEEDED", message: "too many" },
        },
        { status: 429 }
      ) as never
    );
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(429);
    expect(mockedScan).not.toHaveBeenCalled();
  });

  it("accepts token via Authorization Bearer header", async () => {
    const req = new NextRequest("http://localhost/api/cron/overdue-session-reminders", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockedScan).toHaveBeenCalledTimes(1);
  });
});
