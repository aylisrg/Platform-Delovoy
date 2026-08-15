import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockRequireAdminSection = vi.fn();
vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-response")>("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: (...args: unknown[]) => mockRequireAdminSection(...args),
  };
});

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({ logAudit: (...args: unknown[]) => mockLogAudit(...args) }));

const mockAddItemsToBooking = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    PSBookingError: actual.PSBookingError,
    addItemsToBooking: (...args: unknown[]) => mockAddItemsToBooking(...args),
  };
});

import { POST } from "../route";
import { PSBookingError } from "@/modules/ps-park/service";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ps-park/bookings/bk-1/add-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { items: [{ skuId: "sku-1", quantity: 2 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockAddItemsToBooking.mockResolvedValue({ id: "bk-1", metadata: {} });
});

describe("POST /api/ps-park/bookings/:id/add-items", () => {
  it("менеджер добавляет товары в бронь", async () => {
    const res = await POST(makeRequest(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockAddItemsToBooking).toHaveBeenCalledWith("bk-1", "mgr-1", validBody.items);
    expect(mockLogAudit).toHaveBeenCalledWith(
      "mgr-1",
      "booking.add_items",
      "Booking",
      "bk-1",
      expect.objectContaining({ itemCount: 1 })
    );
    expect(body.success).toBe(true);
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody), { params });

    expect(res.status).toBe(401);
    expect(mockAddItemsToBooking).not.toHaveBeenCalled();
  });

  it("не пускает обычного пользователя — 403 FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await POST(makeRequest(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockAddItemsToBooking).not.toHaveBeenCalled();
  });

  it("#622: менеджер без ModuleAssignment на ps-park — requireAdminSection отклоняет", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await POST(makeRequest(validBody), { params });

    expect(res.status).toBe(403);
    expect(mockAddItemsToBooking).not.toHaveBeenCalled();
  });

  it("пустой список товаров — 422, сервис не вызван", async () => {
    const res = await POST(makeRequest({ items: [] }), { params });

    expect(res.status).toBe(422);
    expect(mockAddItemsToBooking).not.toHaveBeenCalled();
  });

  it("недостаточно остатка на складе — код ошибки сервиса прокидывается как есть", async () => {
    mockAddItemsToBooking.mockRejectedValue(new PSBookingError("INSUFFICIENT_STOCK", "Недостаточно товара на складе"));

    const res = await POST(makeRequest(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("неожиданная ошибка сервиса — 500, без утечки деталей", async () => {
    mockAddItemsToBooking.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
