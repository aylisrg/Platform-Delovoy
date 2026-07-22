import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAudit: vi.fn(),
}));
vi.mock("@/lib/metrika-server", () => ({ trackServerGoal: vi.fn() }));
vi.mock("@/modules/cafe/service", () => {
  class OrderError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "OrderError";
    }
  }
  return { createCheckout: vi.fn(), OrderError };
});

import { POST } from "../route";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createCheckout, OrderError } from "@/modules/cafe/service";
import { trackServerGoal } from "@/lib/metrika-server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/cafe/checkout", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const validBody = { items: [{ menuItemId: "item-1", quantity: 2 }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(rateLimit).mockResolvedValue(null as never);
});

describe("POST /api/cafe/checkout", () => {
  it("гость: 201 с заказом и confirmationUrl, серверная цель Метрики", async () => {
    vi.mocked(createCheckout).mockResolvedValue({
      id: "order-1",
      totalAmount: 430,
      payment: { id: "pay-1", confirmationUrl: "https://yookassa.example/pay" },
    } as never);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.payment.confirmationUrl).toBe("https://yookassa.example/pay");

    expect(createCheckout).toHaveBeenCalledWith(null, validBody);
    expect(trackServerGoal).toHaveBeenCalledWith(
      expect.objectContaining({ target: "cafe_order_submit", price: 430 })
    );
  });

  it("залогиненный: userId уходит в сервис", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(createCheckout).mockResolvedValue({
      id: "order-1",
      totalAmount: 100,
      payment: null,
    } as never);

    await POST(makeRequest(validBody));
    expect(createCheckout).toHaveBeenCalledWith("user-1", validBody);
  });

  it("rate limit: 429 из rateLimit отдаётся как есть", async () => {
    const limited = new Response(null, { status: 429 });
    vi.mocked(rateLimit).mockResolvedValue(limited as never);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("невалидное тело: 422 без вызова сервиса", async () => {
    const res = await POST(makeRequest({ items: [] }));
    expect(res.status).toBe(422);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("PAYMENT_CONTACT_REQUIRED из сервиса → 422 с кодом", async () => {
    vi.mocked(createCheckout).mockRejectedValue(
      new OrderError("PAYMENT_CONTACT_REQUIRED", "Для чека нужен email или телефон")
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PAYMENT_CONTACT_REQUIRED");
  });

  it("ITEM_NOT_FOUND → 400", async () => {
    vi.mocked(createCheckout).mockRejectedValue(
      new OrderError("ITEM_NOT_FOUND", "Позиции не найдены")
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
  });

  it("неожиданная ошибка → 500 без деталей", async () => {
    vi.mocked(createCheckout).mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
  });
});
