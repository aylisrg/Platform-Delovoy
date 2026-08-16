import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/avito", () => ({
  syncItemsRegistry: vi.fn(),
  syncAccount: vi.fn(),
}));

import { syncItemsRegistry, syncAccount } from "@/lib/avito";
import { GET, POST } from "../route";

const mockedSyncItems = vi.mocked(syncItemsRegistry);
const mockedSyncAccount = vi.mocked(syncAccount);

function makeReq(token: string | null, method: "GET" | "POST" = "GET"): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/avito-account-sync"
      : `http://localhost/api/cron/avito-account-sync?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  process.env.AVITO_CRON_ENABLED = "true";
  mockedSyncItems.mockResolvedValue({ synced: 0 } as never);
  mockedSyncAccount.mockResolvedValue(undefined as never);
});

describe("GET /api/cron/avito-account-sync", () => {
  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedSyncItems).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedSyncItems).not.toHaveBeenCalled();
  });

  it("skips sync when AVITO_CRON_ENABLED is not 'true'", async () => {
    delete process.env.AVITO_CRON_ENABLED;
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(mockedSyncItems).not.toHaveBeenCalled();
    expect(mockedSyncAccount).not.toHaveBeenCalled();
  });

  it("happy path: syncs items registry and account when enabled", async () => {
    mockedSyncItems.mockResolvedValue({ synced: 3 } as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedSyncItems).toHaveBeenCalledTimes(1);
    expect(mockedSyncAccount).toHaveBeenCalledTimes(1);
    expect(body.data.items).toEqual({ synced: 3 });
  });

  it("returns 500 when syncItemsRegistry throws", async () => {
    mockedSyncItems.mockRejectedValue(new Error("avito api down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/cron/avito-account-sync", () => {
  it("behaves the same as GET (auth + sync)", async () => {
    const res = await POST(makeReq("test-cron-secret", "POST"));
    expect(res.status).toBe(200);
    expect(mockedSyncItems).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid token with 401", async () => {
    const res = await POST(makeReq("nope", "POST"));
    expect(res.status).toBe(401);
  });
});
