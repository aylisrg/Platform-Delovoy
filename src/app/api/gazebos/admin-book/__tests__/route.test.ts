import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockCreateAdminBooking = vi.fn();
vi.mock("@/modules/gazebos/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/gazebos/service")>(
    "@/modules/gazebos/service"
  );
  return {
    ...actual,
    createAdminBooking: (...args: unknown[]) => mockCreateAdminBooking(...args),
  };
});

import { POST } from "../route";
import { BookingError } from "@/modules/gazebos/service";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gazebos/admin-book", {
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
  clientName: "Иван",
  clientPhone: "+79001234567",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockCreateAdminBooking.mockResolvedValue({ id: "bk-1" });
});

describe("POST /api/gazebos/admin-book", () => {
  it("менеджер создаёт подтверждённую бронь клиенту", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockCreateAdminBooking).toHaveBeenCalledWith("mgr-1", expect.objectContaining({ clientName: "Иван" }));
    expect(mockLogAudit).toHaveBeenCalledWith("mgr-1", "booking.admin_create", "Booking", "bk-1", expect.any(Object));
  });

  it("суперадмин тоже проходит role-check (иерархия ролей)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "su-1", role: "SUPERADMIN" } });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(201);
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockCreateAdminBooking).not.toHaveBeenCalled();
  });

  it("не пускает обычного пользователя — 403 FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCreateAdminBooking).not.toHaveBeenCalled();
  });

  it("отклоняет тело без имени клиента — 422, сервис не вызван", async () => {
    const { clientName: _clientName, ...rest } = validBody;
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(422);
    expect(mockCreateAdminBooking).not.toHaveBeenCalled();
  });

  it("BOOKING_CONFLICT от сервиса — код прокидывается как есть", async () => {
    mockCreateAdminBooking.mockRejectedValue(new BookingError("BOOKING_CONFLICT", "Это время уже занято"));

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BOOKING_CONFLICT");
  });

  it("неожиданная ошибка сервиса — 500", async () => {
    mockCreateAdminBooking.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
  });
});
