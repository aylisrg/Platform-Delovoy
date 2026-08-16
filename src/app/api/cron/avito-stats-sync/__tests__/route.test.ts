import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    avitoItem: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/avito", () => ({
  refreshItemSnapshot: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { refreshItemSnapshot } from "@/lib/avito";
import { GET, POST } from "../route";

const mockedFindMany = vi.mocked(prisma.avitoItem.findMany);
const mockedRefresh = vi.mocked(refreshItemSnapshot);

function makeReq(token: string | null): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/avito-stats-sync"
      : `http://localhost/api/cron/avito-stats-sync?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  process.env.AVITO_CRON_ENABLED = "true";
  mockedFindMany.mockResolvedValue([]);
  mockedRefresh.mockResolvedValue(undefined as never);
});

describe("GET /api/cron/avito-stats-sync", () => {
  it("returns 401 when token is missing or wrong", async () => {
    for (const req of [makeReq(null), makeReq("wrong")]) {
      const res = await GET(req);
      expect(res.status).toBe(401);
    }
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it("skips when AVITO_CRON_ENABLED is not 'true'", async () => {
    delete process.env.AVITO_CRON_ENABLED;
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it("happy path: refreshes 7d + 30d snapshots for every active item", async () => {
    mockedFindMany.mockResolvedValue([
      { id: "i1", avitoItemId: "a1" },
      { id: "i2", avitoItemId: "a2" },
    ] as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedRefresh).toHaveBeenCalledTimes(4); // 2 items × 2 periods
    expect(mockedRefresh).toHaveBeenCalledWith("i1", "a1", "7d");
    expect(mockedRefresh).toHaveBeenCalledWith("i1", "a1", "30d");
    expect(body.data).toEqual({ items: 2, snapshotsOk: 4, snapshotsFailed: 0 });
    // Only ACTIVE, non-deleted items — per the where clause in the route.
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE", deletedAt: null } })
    );
  });

  it("keeps going and counts failures when a single snapshot refresh fails", async () => {
    mockedFindMany.mockResolvedValue([{ id: "i1", avitoItemId: "a1" }] as never);
    mockedRefresh.mockRejectedValueOnce(new Error("api timeout")).mockResolvedValueOnce(undefined as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ items: 1, snapshotsOk: 1, snapshotsFailed: 1 });
  });

  it("returns 500 when the items query itself throws", async () => {
    mockedFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/cron/avito-stats-sync", () => {
  it("rejects invalid token with 401 (same as GET)", async () => {
    const res = await POST(makeReq("nope"));
    expect(res.status).toBe(401);
  });
});
