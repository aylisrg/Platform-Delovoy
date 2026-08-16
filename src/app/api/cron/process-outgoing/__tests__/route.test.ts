import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/notifications/dispatch/dispatcher", () => ({
  processOutgoing: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}));

import { processOutgoing } from "@/modules/notifications/dispatch/dispatcher";
import { GET } from "../route";

const mockedProcess = vi.mocked(processOutgoing);

function makeReq(token: string | null): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/process-outgoing"
      : `http://localhost/api/cron/process-outgoing?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  mockedProcess.mockResolvedValue({ sent: 0, failed: 0 } as never);
});

describe("GET /api/cron/process-outgoing", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq("anything"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(mockedProcess).not.toHaveBeenCalled();
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

  it("accepts token via Authorization Bearer header", async () => {
    const req = new NextRequest("http://localhost/api/cron/process-outgoing", {
      method: "GET",
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockedProcess).toHaveBeenCalledTimes(1);
  });

  it("happy path: processes an outgoing batch of up to 100", async () => {
    mockedProcess.mockResolvedValue({ sent: 7, failed: 1 } as never);
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedProcess).toHaveBeenCalledWith(100);
    expect(body.data).toMatchObject({ sent: 7, failed: 1 });
  });

  it("returns 500 when processOutgoing throws", async () => {
    mockedProcess.mockRejectedValue(new Error("dispatch failed"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});
