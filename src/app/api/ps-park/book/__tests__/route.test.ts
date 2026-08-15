import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockCreateBooking = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    ...actual,
    createBooking: (...args: unknown[]) => mockCreateBooking(...args),
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });
  mockCreateBooking.mockResolvedValue({ id: "bk-1", metadata: {} });
});

describe("POST /api/ps-park/book", () => {
  it("создаёт бронь авторизованному пользователю", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateBooking).toHaveBeenCalledWith("user-1", expect.objectContaining({ resourceId: "table-1" }));
    expect(mockLogAudit).toHaveBeenCalledWith("user-1", "booking.create", "Booking", "bk-1", expect.any(Object));
  });

  it("требует авторизацию — гостевого бронирования в ps-park нет", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockCreateBooking).not.toHaveBeenCalled();
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
});
