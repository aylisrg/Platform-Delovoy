import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/inventory/service-v2", () => ({
  getExpiringBatches: vi.fn(),
}));
vi.mock("@/modules/inventory/alerts", () => ({
  runLowStockAlertSweep: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    systemEvent: { create: vi.fn() },
  },
}));

import { getExpiringBatches } from "@/modules/inventory/service-v2";
import { runLowStockAlertSweep } from "@/modules/inventory/alerts";
import { prisma } from "@/lib/db";
import { GET } from "../route";

const mockedGetExpiring = vi.mocked(getExpiringBatches);
const mockedSweep = vi.mocked(runLowStockAlertSweep);
const mockedCreateEvent = vi.mocked(prisma.systemEvent.create);

function makeReq(token: string | null): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/inventory"
      : `http://localhost/api/cron/inventory?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method: "GET" });
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

  it("falls back to NEXTAUTH_SECRET when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    process.env.NEXTAUTH_SECRET = "auth-secret";
    const res = await GET(makeReq("auth-secret"));
    expect(res.status).toBe(200);
    expect(mockedGetExpiring).toHaveBeenCalledTimes(1);
    delete process.env.NEXTAUTH_SECRET;
  });

  it("happy path: no expired batches, no SystemEvent written", async () => {
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.expiredBatches).toBe(0);
    expect(body.data.lowStockAlerts).toEqual({ checked: 0, alerted: 0 });
    expect(mockedCreateEvent).not.toHaveBeenCalled();
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
    expect(mockedCreateEvent).toHaveBeenCalledTimes(1);
    const call = mockedCreateEvent.mock.calls[0][0] as { data: { level: string; source: string } };
    expect(call.data.level).toBe("WARNING");
    expect(call.data.source).toBe("cron/inventory");
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
