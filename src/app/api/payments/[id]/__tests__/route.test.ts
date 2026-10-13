import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/payments/service", () => ({ pollPayment: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));

import { GET } from "../route";
import { pollPayment } from "@/modules/payments/service";
import { rateLimit } from "@/lib/rate-limit";

const mockedPoll = vi.mocked(pollPayment);
const mockedRateLimit = vi.mocked(rateLimit);

function call(id = "pay-1") {
  return GET(new NextRequest(`http://localhost/api/payments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRateLimit.mockResolvedValue(null);
});

describe("GET /api/payments/[id]", () => {
  it("применяет rate limit тира payment-status", async () => {
    mockedPoll.mockResolvedValue({ status: "PENDING", confirmationUrl: null } as never);
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockedRateLimit).toHaveBeenCalledWith(expect.anything(), "payment-status");
  });

  it("при превышении лимита отвечает 429 и не ходит к провайдеру", async () => {
    mockedRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 429 }) as never
    );
    const res = await call();
    expect(res.status).toBe(429);
    expect(mockedPoll).not.toHaveBeenCalled();
  });

  it("404 для неизвестного платежа", async () => {
    mockedPoll.mockResolvedValue(null as never);
    expect((await call("nope")).status).toBe(404);
  });
});
