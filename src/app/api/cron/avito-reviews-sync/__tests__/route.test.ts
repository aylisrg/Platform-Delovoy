import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/avito", () => ({
  syncAllReviews: vi.fn(),
}));

import { syncAllReviews } from "@/lib/avito";
import { GET, POST } from "../route";

const mockedSync = syncAllReviews as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "secret-token";
  delete process.env.AVITO_CRON_ENABLED;
});

function makeReq(token: string | null): NextRequest {
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  return new NextRequest("http://localhost/api/cron/avito-reviews-sync", { method: "GET", headers });
}

describe("GET /api/cron/avito-reviews-sync", () => {
  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("skips sync when AVITO_CRON_ENABLED is not 'true'", async () => {
    const res = await GET(makeReq("secret-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("invokes syncAllReviews and returns counters when enabled", async () => {
    process.env.AVITO_CRON_ENABLED = "true";
    mockedSync.mockResolvedValue({ items: 4, added: 7, alerted: 2 });

    const res = await GET(makeReq("secret-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedSync).toHaveBeenCalledTimes(1);
    expect(body.data).toEqual({ items: 4, added: 7, alerted: 2 });
  });

  it("returns 500 when syncAllReviews throws", async () => {
    process.env.AVITO_CRON_ENABLED = "true";
    mockedSync.mockRejectedValue(new Error("boom"));

    const res = await GET(makeReq("secret-token"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/cron/avito-reviews-sync", () => {
  it("rejects invalid token with 401 (same as GET)", async () => {
    const res = await POST(makeReq("nope"));
    expect(res.status).toBe(401);
  });
});

describe("#1074: query ?token= is not accepted", () => {
  it("returns 401 for a valid secret passed only as ?token=", async () => {
    const secret = process.env.CRON_SECRET ?? "";
    const req = new NextRequest(`http://localhost/api/cron/avito-reviews-sync?token=${encodeURIComponent(secret)}`, { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
