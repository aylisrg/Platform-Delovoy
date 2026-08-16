import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/yookassa/client", () => ({
  isYooKassaConfigured: vi.fn(),
}));
vi.mock("@/modules/payments/service", () => ({
  reconcilePayments: vi.fn(),
}));

import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { reconcilePayments } from "@/modules/payments/service";
import { GET } from "../route";

const mockedConfigured = vi.mocked(isYooKassaConfigured);
const mockedReconcile = vi.mocked(reconcilePayments);

function makeReq(token: string | null): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/payments-reconcile"
      : `http://localhost/api/cron/payments-reconcile?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  mockedConfigured.mockReturnValue(true);
  mockedReconcile.mockResolvedValue({ checked: 0, resolved: 0 } as never);
});

describe("GET /api/cron/payments-reconcile", () => {
  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured (no fallback that leaks an empty-secret bypass)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(""));
    expect(res.status).toBe(401);
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("accepts token via Authorization Bearer header", async () => {
    const req = new NextRequest("http://localhost/api/cron/payments-reconcile", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockedReconcile).toHaveBeenCalledTimes(1);
  });

  it("skips reconciliation when YooKassa is not configured", async () => {
    mockedConfigured.mockReturnValue(false);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(body.data.reason).toBe("yookassa_not_configured");
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it("happy path: invokes reconcilePayments and returns the report", async () => {
    mockedReconcile.mockResolvedValue({ checked: 5, resolved: 2 } as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedReconcile).toHaveBeenCalledTimes(1);
    expect(body.data.report).toEqual({ checked: 5, resolved: 2 });
  });

  it("returns 500 when reconcilePayments throws", async () => {
    mockedReconcile.mockRejectedValue(new Error("provider down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});
