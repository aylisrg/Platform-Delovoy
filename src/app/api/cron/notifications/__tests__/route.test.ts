import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/notifications/scheduler", () => ({
  processScheduledNotifications: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

import { processScheduledNotifications } from "@/modules/notifications/scheduler";
import { GET } from "../route";

const mockedProcess = vi.mocked(processScheduledNotifications);

function makeReq(token: string | null): NextRequest {
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  return new NextRequest("http://localhost/api/cron/notifications", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  mockedProcess.mockResolvedValue(undefined);
});

describe("GET /api/cron/notifications", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq("anything"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(mockedProcess).not.toHaveBeenCalled();
  });

  it("no longer falls back to NEXTAUTH_SECRET", async () => {
    delete process.env.CRON_SECRET;
    process.env.NEXTAUTH_SECRET = "auth-secret";
    const res = await GET(makeReq("auth-secret"));
    expect(res.status).toBe(503);
    expect(mockedProcess).not.toHaveBeenCalled();
    delete process.env.NEXTAUTH_SECRET;
  });

  it("returns 401 when token is missing or wrong", async () => {
    for (const req of [makeReq(null), makeReq("wrong")]) {
      const res = await GET(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
    expect(mockedProcess).not.toHaveBeenCalled();
  });

  it("accepts token via Authorization Bearer header (preferred for crontab)", async () => {
    const req = new NextRequest("http://localhost/api/cron/notifications", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockedProcess).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when scheduler throws", async () => {
    mockedProcess.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("#1074: query ?token= is not accepted", () => {
  it("returns 401 for a valid secret passed only as ?token=", async () => {
    const secret = process.env.CRON_SECRET ?? "";
    const req = new NextRequest(`http://localhost/api/cron/notifications?token=${encodeURIComponent(secret)}`, { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
