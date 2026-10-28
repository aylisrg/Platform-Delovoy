import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...args: unknown[]) => mockRateLimit(...args) }));

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockProductEventCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { productEvent: { create: (...args: unknown[]) => mockProductEventCreate(...args) } },
}));
vi.mock("@/lib/redis", () => ({ redis: { set: vi.fn() }, redisAvailable: false }));

const mockCreateBooking = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    ...actual,
    createPrepaidBooking: (...args: unknown[]) => mockCreateBooking(...args),
  };
});

import { POST } from "../route";
import { PSBookingError } from "@/modules/ps-park/service";
import { InventoryError } from "@/modules/inventory/service";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ps-park/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  resourceId: "table-1",
  date: "2026-06-15",
  startTime: "10:00",
  endTime: "12:00",
  requestId: "0cfe64dd-7867-4f53-a68b-067c211bc2f1",
  guestName: "Гость",
  guestPhone: "+79991234567",
  email: "guest@example.com",
  acceptOffer: true,
  offerVersionSlug: "test-offer",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
  mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });
  mockCreateBooking.mockResolvedValue({ id: "bk-1", payment: { id: "pay-1", confirmationUrl: "https://example.com/pay" } });
  mockProductEventCreate.mockRejectedValue(new Error("db down"));
});

describe("POST /api/ps-park/book", () => {
  it("ограничивает гостевые запросы до авторизации и создания брони", async () => {
    mockRateLimit.mockResolvedValue(NextResponse.json({ success: false, error: { code: "RATE_LIMITED" } }, { status: 429 }));
    const request = makeRequest(validBody);
    expect((await POST(request)).status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledWith(request, "public");
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockCreateBooking).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
  it("создаёт бронь авторизованному пользователю", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateBooking).toHaveBeenCalledWith("user-1", expect.objectContaining({ resourceId: "table-1" }), expect.any(Object));
    expect(body.data.payment.confirmationUrl).toBe("https://example.com/pay");
    expect(mockLogAudit).toHaveBeenCalledWith("user-1", "booking.create", "Booking", "bk-1", expect.any(Object));
  });

  it("создаёт гостю платёж без регистрации и логирует действие", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(201);
    expect(mockCreateBooking).toHaveBeenCalledWith(null, expect.objectContaining({ guestName: "Гость" }), expect.any(Object));
    expect(mockLogAudit).toHaveBeenCalledWith("system", "booking.create", "Booking", "bk-1", expect.any(Object));
  });

  it("отклоняет тело без resourceId — 422, сервис не вызван", async () => {
    const { resourceId: _resourceId, ...rest } = validBody;
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(422);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("отклоняет startTime >= endTime — 422 (refine-проверка схемы)", async () => {
    const res = await POST(makeRequest({ ...validBody, startTime: "14:00", endTime: "12:00" }));

    expect(res.status).toBe(422);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("BOOKING_CONFLICT от сервиса — код и сообщение прокидываются как есть", async () => {
    mockCreateBooking.mockRejectedValue(new PSBookingError("BOOKING_CONFLICT", "Это время уже занято"));

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BOOKING_CONFLICT");
  });

  it("InventoryError от сервиса — 400", async () => {
    mockCreateBooking.mockRejectedValue(new InventoryError("OUT_OF_STOCK", "Товара не хватает на складе"));

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("OUT_OF_STOCK");
  });

  it("неожиданная ошибка сервиса — 500, без утечки деталей", async () => {
    mockCreateBooking.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("сбой записи в ProductEvent (БД недоступна) не ломает ответ брони — fire-and-forget (AC-1.6)", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockProductEventCreate).toHaveBeenCalledOnce();
  });
});
