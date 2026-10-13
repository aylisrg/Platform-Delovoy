import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/inventory/service-v2", () => ({
  getExpiringBatches: vi.fn(),
}));
vi.mock("@/modules/inventory/alerts", () => ({
  runLowStockAlertSweep: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getExpiringBatches } from "@/modules/inventory/service-v2";
import { runLowStockAlertSweep } from "@/modules/inventory/alerts";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { GET } from "../route";

const mockedGetExpiring = vi.mocked(getExpiringBatches);
const mockedSweep = vi.mocked(runLowStockAlertSweep);
const mockedWarn = vi.mocked(log.warn);

function makeReq(token: string | null): NextRequest {
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  return new NextRequest("http://localhost/api/cron/inventory", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  mockedGetExpiring.mockResolvedValue([]);
  mockedSweep.mockResolvedValue({ checked: 0, alerted: 0 });
});

describe("GET /api/cron/inventory", () => {
  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedGetExpiring).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedGetExpiring).not.toHaveBeenCalled();
  });

  it("transition #1084: accepts NEXTAUTH_SECRET even when CRON_SECRET is not set, warns without value", async () => {
    delete process.env.CRON_SECRET;
    process.env.NEXTAUTH_SECRET = "auth-secret";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(makeReq("auth-secret"));
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("auth-secret");
    warn.mockRestore();
    delete process.env.NEXTAUTH_SECRET;
  });

  it("transition #1084: accepts NEXTAUTH_SECRET as bearer when CRON_SECRET is set", async () => {
    process.env.NEXTAUTH_SECRET = "auth-secret";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(makeReq("auth-secret"));
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    delete process.env.NEXTAUTH_SECRET;
  });

  it("503 when neither secret matches and CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq("whatever"));
    expect(res.status).toBe(503);
    expect(mockedGetExpiring).not.toHaveBeenCalled();
  });

  it("happy path: no expired batches, no SystemEvent written", async () => {
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.expiredBatches).toBe(0);
    expect(body.data.lowStockAlerts).toEqual({ checked: 0, alerted: 0 });
    expect(mockedWarn).not.toHaveBeenCalled();
  });

  it("logs a SystemEvent when there are truly expired batches (daysUntilExpiry <= 0)", async () => {
    mockedGetExpiring.mockResolvedValue([
      { batchId: "b1", skuName: "Милк", remainingQty: 2, expiresAt: new Date(), daysUntilExpiry: -1 },
      { batchId: "b2", skuName: "Сироп", remainingQty: 1, expiresAt: new Date(), daysUntilExpiry: 3 },
    ] as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.expiredBatches).toBe(1);
    expect(mockedWarn).toHaveBeenCalledTimes(1);
    expect(mockedWarn).toHaveBeenCalledWith(
      EVENT_SOURCES.CRON_INVENTORY,
      expect.stringContaining("1"),
      expect.objectContaining({ batches: expect.any(Array) })
    );
  });

  it("returns lowStockAlerts counters from the sweep", async () => {
    mockedSweep.mockResolvedValue({ checked: 5, alerted: 2 });
    const res = await GET(makeReq("test-cron-secret"));
    const body = await res.json();
    expect(body.data.lowStockAlerts).toEqual({ checked: 5, alerted: 2 });
  });

  it("returns 500 when getExpiringBatches throws", async () => {
    mockedGetExpiring.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("#1074: query ?token= is not accepted", () => {
  it("returns 401 for a valid secret passed only as ?token=", async () => {
    const secret = process.env.CRON_SECRET ?? "";
    const req = new NextRequest(`http://localhost/api/cron/inventory?token=${encodeURIComponent(secret)}`, { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
