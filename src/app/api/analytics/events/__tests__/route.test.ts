import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...args: unknown[]) => mockRateLimit(...args) }));

const mockDeriveSessionKey = vi.fn();
const mockRecordFunnelStepAsync = vi.fn();
vi.mock("@/modules/analytics/product-events", () => ({
  deriveSessionKeyFromHeaders: (...args: unknown[]) => mockDeriveSessionKey(...args),
  recordFunnelStepAsync: (...args: unknown[]) => mockRecordFunnelStepAsync(...args),
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
  mockDeriveSessionKey.mockReturnValue("session-key-1");
  mockRecordFunnelStepAsync.mockResolvedValue(undefined);
});

describe("POST /api/analytics/events", () => {
  it("принимает валидный клиентский шаг — 200, sessionKey из заголовков сервера", async () => {
    const res = await POST(makeRequest({ funnel: "gazebos", step: "slot_selected" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockRecordFunnelStepAsync).toHaveBeenCalledWith({
      funnel: "gazebos",
      step: "slot_selected",
      sessionKey: "session-key-1",
    });
  });

  it("отклоняет серверный шаг (submitted) — 422, запись не вызывается", async () => {
    const res = await POST(makeRequest({ funnel: "gazebos", step: "submitted" }));
    expect(res.status).toBe(422);
    expect(mockRecordFunnelStepAsync).not.toHaveBeenCalled();
  });

  it("игнорирует sessionKey и metadata, присланные клиентом (.strict()) — 422", async () => {
    const res = await POST(
      makeRequest({
        funnel: "gazebos",
        step: "slot_selected",
        sessionKey: "forged-key",
        metadata: { amountRub: 1 },
      })
    );
    expect(res.status).toBe(422);
    expect(mockRecordFunnelStepAsync).not.toHaveBeenCalled();
  });

  it("отклоняет неизвестную воронку — 422", async () => {
    const res = await POST(makeRequest({ funnel: "not-a-funnel", step: "view" }));
    expect(res.status).toBe(422);
    expect(mockRecordFunnelStepAsync).not.toHaveBeenCalled();
  });

  it("невалидный JSON в теле — 422, не 500", async () => {
    const req = new NextRequest("http://localhost/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("rate limit: 429 из rateLimit отдаётся как есть, запись не вызывается", async () => {
    const limited = new Response(null, { status: 429 });
    mockRateLimit.mockResolvedValue(limited as never);

    const res = await POST(makeRequest({ funnel: "gazebos", step: "slot_selected" }));
    expect(res.status).toBe(429);
    expect(mockRecordFunnelStepAsync).not.toHaveBeenCalled();
  });
});
