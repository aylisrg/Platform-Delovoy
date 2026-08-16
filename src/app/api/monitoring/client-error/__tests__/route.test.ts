import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    systemEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

const mockedCreate = vi.mocked(prisma.systemEvent.create);
const mockedRateLimit = vi.mocked(rateLimit);

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/monitoring/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedCreate.mockReset();
  mockedRateLimit.mockReset();
  mockedRateLimit.mockResolvedValue(null);
});

describe("POST /api/monitoring/client-error", () => {
  it("accepts a valid beacon and stores a SystemEvent", async () => {
    mockedCreate.mockResolvedValue({ id: "ev1" } as never);
    const res = await POST(
      makeRequest({ message: "ChunkLoadError", source: "window-error" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.accepted).toBe(true);
    expect(mockedCreate).toHaveBeenCalledOnce();
  });

  it("rejects an invalid payload with 422 and does not touch the DB", async () => {
    const res = await POST(makeRequest({ source: "window-error" }));
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response when limited", async () => {
    const limitedResponse = Response.json(
      { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "..." } },
      { status: 429 },
    );
    mockedRateLimit.mockResolvedValue(limitedResponse as never);
    const res = await POST(
      makeRequest({ message: "boom", source: "window-error" }),
    );
    expect(res.status).toBe(429);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("still accepts the beacon when the DB write fails (logger.ts console-fallback, issue #581)", async () => {
    mockedCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(
      makeRequest({ message: "boom", source: "window-error" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.accepted).toBe(true);
    expect(JSON.stringify(json)).not.toContain("db down");
  });
});
