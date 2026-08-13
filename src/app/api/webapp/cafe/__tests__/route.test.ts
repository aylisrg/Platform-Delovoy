import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const mockCreateCheckout = vi.fn();
const mockListOrders = vi.fn();

/**
 * Сервисы кафе не редактируются и в тестах не исполняются (ADR §11, Track B):
 * мок отдаёт собственный `OrderError`, поэтому `instanceof` в роуте работает,
 * а реальный `service.ts` (вместе с БД, ЮKassa и очередью уведомлений) не
 * загружается вовсе.
 */
vi.mock("@/modules/cafe/service", () => {
  class OrderError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "OrderError";
    }
  }
  return {
    OrderError,
    createCheckout: (...args: unknown[]) => mockCreateCheckout(...args),
    listOrders: (...args: unknown[]) => mockListOrders(...args),
  };
});

vi.mock("@/lib/webapp-auth", () => ({ verifyWebAppToken: vi.fn() }));

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

import { verifyWebAppToken } from "@/lib/webapp-auth";
import { OrderError } from "@/modules/cafe/service";
import { POST } from "../checkout/route";
import { GET } from "../orders/route";

const mockUser = { id: "user-1", telegramId: "tg-123", role: "USER" };

function checkoutRequest(body: unknown) {
  return new NextRequest("http://localhost/api/webapp/cafe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function ordersRequest(query = "") {
  return new NextRequest(`http://localhost/api/webapp/cafe/orders${query}`);
}

const orderFromService = {
  id: "clx0000000000000order1",
  moduleSlug: "cafe",
  userId: "user-1",
  status: "NEW",
  totalAmount: 550,
  deliveryTo: "302",
  comment: null,
  paidAt: null,
  deletedAt: null,
  createdAt: new Date("2026-08-13T09:00:00.000Z"),
  updatedAt: new Date("2026-08-13T09:00:00.000Z"),
  items: [{ id: "oi-1", orderId: "clx0000000000000order1", menuItemId: "mi-1", name: "Капучино", quantity: 2, price: 275 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
  mockRateLimit.mockResolvedValue(null);
});

describe("POST /api/webapp/cafe/checkout", () => {
  it("returns 401 without a valid Mini App token", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await POST(checkoutRequest({ items: [{ menuItemId: "mi-1", quantity: 1 }] }));

    expect(res.status).toBe(401);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
    // Rate limit не тратим на неаутентифицированный запрос: тир authenticated
    // ключуется по userId, которого ещё нет.
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("returns 422 on an empty items array without touching the service", async () => {
    const res = await POST(checkoutRequest({ items: [] }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("returns 422 on a malformed body", async () => {
    const res = await POST(checkoutRequest("not-json"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("stops on the authenticated rate limit before creating an order", async () => {
    mockRateLimit.mockResolvedValue(
      NextResponse.json(
        { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many" } },
        { status: 429 }
      )
    );

    const res = await POST(checkoutRequest({ items: [{ menuItemId: "mi-1", quantity: 1 }] }));

    expect(res.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "user-1");
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("happy path: 201, createCheckout called with the caller's user id, AuditLog written", async () => {
    mockCreateCheckout.mockResolvedValue({
      ...orderFromService,
      payment: { id: "pay-1", confirmationUrl: "https://yookassa.ru/pay/1" },
    });

    const res = await POST(
      checkoutRequest({
        items: [{ menuItemId: "mi-1", quantity: 2 }],
        deliveryTo: "302",
        customerEmail: "guest@example.com",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    // Ключевое отличие от гостевого /api/cafe/checkout: заказ атрибутирован
    // пользователю, а не null.
    expect(mockCreateCheckout).toHaveBeenCalledWith("user-1", {
      items: [{ menuItemId: "mi-1", quantity: 2 }],
      deliveryTo: "302",
      customerEmail: "guest@example.com",
    });
    expect(json.data.id).toBe("clx0000000000000order1");
    expect(json.data.orderNumber).toBe("ORDER1");
    expect(json.data.totalAmount).toBe(550);
    expect(json.data.payment).toEqual({ id: "pay-1", confirmationUrl: "https://yookassa.ru/pay/1" });
    expect(json.data.items).toEqual([{ name: "Капучино", quantity: 2, price: 275 }]);
    expect(mockLogAudit).toHaveBeenCalledWith(
      "user-1",
      "order.create",
      "Order",
      "clx0000000000000order1",
      expect.objectContaining({ source: "webapp" })
    );
  });

  it("keeps service-internal order fields out of the response", async () => {
    mockCreateCheckout.mockResolvedValue({ ...orderFromService, payment: null });

    const res = await POST(checkoutRequest({ items: [{ menuItemId: "mi-1", quantity: 2 }] }));
    const json = await res.json();

    expect(json.data.payment).toBeNull();
    expect(json.data).not.toHaveProperty("userId");
    expect(json.data).not.toHaveProperty("moduleSlug");
    expect(json.data).not.toHaveProperty("deletedAt");
  });

  it("maps an OrderError to 400 with its own code", async () => {
    mockCreateCheckout.mockRejectedValue(
      new OrderError("ITEM_NOT_FOUND", "Позиции не найдены: mi-9")
    );

    const res = await POST(checkoutRequest({ items: [{ menuItemId: "mi-9", quantity: 1 }] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("ITEM_NOT_FOUND");
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("maps PAYMENT_CONTACT_REQUIRED to 422 so the client can ask for an email", async () => {
    mockCreateCheckout.mockRejectedValue(
      new OrderError("PAYMENT_CONTACT_REQUIRED", "Нужен email для чека")
    );

    const res = await POST(checkoutRequest({ items: [{ menuItemId: "mi-1", quantity: 1 }] }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("PAYMENT_CONTACT_REQUIRED");
  });
});

describe("GET /api/webapp/cafe/orders", () => {
  it("returns 401 without a valid Mini App token", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await GET(ordersRequest());

    expect(res.status).toBe(401);
    expect(mockListOrders).not.toHaveBeenCalled();
  });

  it("returns 429 from rate limit without calling the service (QA 2026-08-13, №3)", async () => {
    const { apiError } = await import("@/lib/api-response");
    mockRateLimit.mockResolvedValue(
      apiError("RATE_LIMIT_EXCEEDED", "Слишком много запросов", 429)
    );

    const res = await GET(ordersRequest());

    expect(res.status).toBe(429);
    expect(mockListOrders).not.toHaveBeenCalled();
  });

  it("scopes the listing to the caller and hides the joined user record", async () => {
    mockListOrders.mockResolvedValue({
      orders: [
        {
          ...orderFromService,
          paidAt: new Date("2026-08-13T09:05:00.000Z"),
          user: { name: "Иван Тестовый", email: "private@example.com" },
        },
      ],
      total: 1,
    });

    const res = await GET(ordersRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    // userId берётся из токена, а не из query — чужие заказы недостижимы.
    expect(mockListOrders).toHaveBeenCalledWith({ userId: "user-1" });
    expect(json.data.orders).toEqual([
      {
        id: "clx0000000000000order1",
        orderNumber: "ORDER1",
        status: "NEW",
        totalAmount: 550,
        paidAt: "2026-08-13T09:05:00.000Z",
        createdAt: "2026-08-13T09:00:00.000Z",
        items: [{ name: "Капучино", quantity: 2, price: 275 }],
      },
    ]);
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("private@example.com");
    expect(raw).not.toContain("Иван Тестовый");
  });

  it("applies the query limit", async () => {
    mockListOrders.mockResolvedValue({
      orders: [orderFromService, { ...orderFromService, id: "clx0000000000000order2" }],
      total: 2,
    });

    const res = await GET(ordersRequest("?limit=1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.orders).toHaveLength(1);
  });

  it("returns 422 on an out-of-range limit", async () => {
    const res = await GET(ordersRequest("?limit=500"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockListOrders).not.toHaveBeenCalled();
  });
});
