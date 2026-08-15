import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockLogAudit = vi.fn();
const mockLogInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
  log: { info: (...args: unknown[]) => mockLogInfo(...args) },
}));

const mockCreateBooking = vi.fn();
vi.mock("@/modules/gazebos/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/gazebos/service")>(
    "@/modules/gazebos/service"
  );
  return {
    ...actual,
    createBooking: (...args: unknown[]) => mockCreateBooking(...args),
  };
});

import { POST } from "../route";
import { BookingError } from "@/modules/gazebos/service";
import { InventoryError } from "@/modules/inventory/service";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gazebos/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  resourceId: "res-1",
  date: "2026-06-15",
  startTime: "10:00",
  endTime: "12:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });
  mockCreateBooking.mockResolvedValue({ id: "bk-1", metadata: {} });
});

describe("POST /api/gazebos/book", () => {
  it("создаёт бронь авторизованному пользователю", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateBooking).toHaveBeenCalledWith("user-1", expect.objectContaining({ resourceId: "res-1" }));
    expect(mockLogAudit).toHaveBeenCalledWith("user-1", "booking.create", "Booking", "bk-1", expect.any(Object));
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it("гостевое бронирование с именем и телефоном — без сессии", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest({ ...validBody, guestName: "Иван", guestPhone: "+79001234567" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateBooking).toHaveBeenCalledWith(null, expect.objectContaining({ guestName: "Иван" }));
    // Гостевые брони не привязаны к User — в AuditLog не попадают, только SystemEvent info.
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith("gazebos", "Guest booking created", expect.any(Object));
  });

  it("гостевое бронирование без контактов — 400 GUEST_CONTACTS_REQUIRED, сервис не вызван", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("GUEST_CONTACTS_REQUIRED");
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("гостевое бронирование с телефоном, но без имени — тоже 400", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest({ ...validBody, guestPhone: "+79001234567" }));

    expect(res.status).toBe(400);
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
    mockCreateBooking.mockRejectedValue(new BookingError("BOOKING_CONFLICT", "Это время уже занято"));

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
