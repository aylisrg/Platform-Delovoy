import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/management/service", () => ({
  processRecurring: vi.fn(),
}));

import { processRecurring } from "@/modules/management/service";
import { GET } from "../route";

const mockedProcess = vi.mocked(processRecurring);

function makeReq(token: string | null): NextRequest {
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  return new NextRequest("http://localhost/api/cron/process-recurring", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  mockedProcess.mockResolvedValue({ processed: 0 } as never);
});

describe("GET /api/cron/process-recurring", () => {
  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedProcess).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedProcess).not.toHaveBeenCalled();
  });

  it("accepts token via Authorization Bearer header", async () => {
    const req = new NextRequest("http://localhost/api/cron/process-recurring", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockedProcess).toHaveBeenCalledTimes(1);
  });

  it("no NEXTAUTH_SECRET fallback: 503 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    process.env.NEXTAUTH_SECRET = "auth-secret";
    const res = await GET(makeReq("auth-secret"));
    expect(res.status).toBe(503);
    expect(mockedProcess).not.toHaveBeenCalled();
    delete process.env.NEXTAUTH_SECRET;
  });

  it("rejects NEXTAUTH_SECRET as bearer when CRON_SECRET is set (401)", async () => {
    process.env.NEXTAUTH_SECRET = "auth-secret";
    const res = await GET(makeReq("auth-secret"));
    expect(res.status).toBe(401);
    expect(mockedProcess).not.toHaveBeenCalled();
    delete process.env.NEXTAUTH_SECRET;
  });

  it("happy path: invokes processRecurring and returns its result", async () => {
    mockedProcess.mockResolvedValue({ processed: 3, totalAmount: 15000 } as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ processed: 3, totalAmount: 15000 });
  });

  it("returns 500 when processRecurring throws", async () => {
    mockedProcess.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("#1074: query ?token= is not accepted", () => {
  it("returns 401 for a valid secret passed only as ?token=", async () => {
    const secret = process.env.CRON_SECRET ?? "";
    const req = new NextRequest(`http://localhost/api/cron/process-recurring?token=${encodeURIComponent(secret)}`, { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
