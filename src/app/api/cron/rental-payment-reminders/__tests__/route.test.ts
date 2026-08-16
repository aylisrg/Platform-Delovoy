import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/rental/scheduler", () => ({
  runRentalPaymentReminders: vi.fn(),
}));

import { runRentalPaymentReminders } from "@/modules/rental/scheduler";
import { GET } from "../route";

const mockedRun = vi.mocked(runRentalPaymentReminders);

function makeReq(token: string | null): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/rental-payment-reminders"
      : `http://localhost/api/cron/rental-payment-reminders?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  mockedRun.mockResolvedValue({ sent: 0 } as never);
});

describe("GET /api/cron/rental-payment-reminders", () => {
  it("returns 401 when token is missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(""));
    expect(res.status).toBe(401);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("accepts token via Authorization Bearer header", async () => {
    const req = new NextRequest("http://localhost/api/cron/rental-payment-reminders", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("happy path: invokes runRentalPaymentReminders and returns the report", async () => {
    mockedRun.mockResolvedValue({ sent: 4, skipped: 1 } as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(body.data.report).toEqual({ sent: 4, skipped: 1 });
  });

  it("returns 500 when runRentalPaymentReminders throws", async () => {
    mockedRun.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});
