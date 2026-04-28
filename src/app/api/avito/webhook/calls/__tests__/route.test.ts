/**
 * Integration tests for POST /api/avito/webhook/calls.
 *
 * The route MUST always respond 200 OK (Avito retries on non-2xx).
 * Branches covered:
 *   - missing/invalid token       → 200 + accepted=false
 *   - bad JSON                    → 200 + accepted=false
 *   - schema mismatch             → 200 + accepted=false
 *   - happy path                  → 200 + accepted=true, processCallWebhook called once
 *   - duplicate (idempotent retry)→ 200 + accepted=true, created=false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// === Mocks =========================================================

const { verifyTokenMock, processCallMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  processCallMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    systemEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    pipeline: vi.fn(() => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue([[null, 0], [null, 0], [null, 1], [null, 1]]),
    })),
  },
  redisAvailable: false, // disable rate-limit during tests by default
}));

vi.mock("@/lib/avito/webhook-security", () => ({
  verifyAvitoWebhookToken: (...args: unknown[]) => verifyTokenMock(...args),
}));

vi.mock("@/lib/avito/calls", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/avito/calls")>("@/lib/avito/calls");
  return {
    ...actual,
    processCallWebhook: (...args: unknown[]) => processCallMock(...args),
  };
});

import { NextRequest } from "next/server";
import { POST } from "../route";

const VALID_BODY = {
  id: "evt-1",
  payload: {
    type: "call.missed",
    value: {
      call_id: "call-route-1",
      item_id: 1234567890,
      caller_phone: "+79001234567",
      duration: 0,
      started_at: 1714300000,
    },
  },
};

function makeRequest(opts: {
  token?: string | null;
  rawBody?: string;
  body?: unknown;
}): NextRequest {
  const url = new URL("http://localhost/api/avito/webhook/calls");
  if (opts.token !== null && opts.token !== undefined) {
    url.searchParams.set("token", opts.token);
  }
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body:
      opts.rawBody !== undefined
        ? opts.rawBody
        : JSON.stringify(opts.body ?? VALID_BODY),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyTokenMock.mockResolvedValue({ ok: true });
  processCallMock.mockResolvedValue({
    created: true,
    callEventId: "ce-1",
    taskCreated: true,
    taskId: "task-1",
  });
});

describe("POST /api/avito/webhook/calls", () => {
  it("returns 200 + accepted=false when token is missing", async () => {
    verifyTokenMock.mockResolvedValue({ ok: false, reason: "MISSING_TOKEN" });

    const res = await POST(makeRequest({ token: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(false);
    expect(body.data.reason).toBe("auth");
    expect(processCallMock).not.toHaveBeenCalled();
  });

  it("returns 200 + accepted=false when token is invalid", async () => {
    verifyTokenMock.mockResolvedValue({ ok: false, reason: "INVALID_TOKEN" });

    const res = await POST(makeRequest({ token: "wrong" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(false);
    expect(processCallMock).not.toHaveBeenCalled();
  });

  it("returns 200 + accepted=false on malformed JSON body", async () => {
    const res = await POST(
      makeRequest({ token: "abc", rawBody: "{not json" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(false);
    expect(body.data.reason).toBe("bad_json");
    expect(processCallMock).not.toHaveBeenCalled();
  });

  it("returns 200 + accepted=false on schema validation failure", async () => {
    const res = await POST(
      makeRequest({ token: "abc", body: { foo: "bar" } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(false);
    expect(body.data.reason).toBe("invalid_payload");
    expect(processCallMock).not.toHaveBeenCalled();
  });

  it("invokes processCallWebhook on the happy path", async () => {
    const res = await POST(makeRequest({ token: "abc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.created).toBe(true);
    expect(body.data.taskCreated).toBe(true);
    expect(processCallMock).toHaveBeenCalledOnce();
  });

  it("idempotent retry: second POST with same call_id returns created=false", async () => {
    // First call — fresh.
    await POST(makeRequest({ token: "abc" }));
    // Second call — processCallWebhook reports duplicate.
    processCallMock.mockResolvedValueOnce({
      created: false,
      callEventId: "ce-1",
      taskCreated: false,
      taskId: null,
    });
    const res = await POST(makeRequest({ token: "abc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.created).toBe(false);
    expect(body.data.taskCreated).toBe(false);
    expect(processCallMock).toHaveBeenCalledTimes(2);
  });

  it("returns 200 even when processCallWebhook throws", async () => {
    processCallMock.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(makeRequest({ token: "abc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accepted).toBe(false);
    expect(body.data.reason).toBe("internal_error");
  });
});
