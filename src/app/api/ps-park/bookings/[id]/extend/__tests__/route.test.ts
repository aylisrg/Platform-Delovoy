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
vi.mock("@/lib/logger", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockExtendBooking = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    ...actual,
    extendBooking: (...args: unknown[]) => mockExtendBooking(...args),
  };
});

import { POST } from "../route";
import { PSBookingError } from "@/modules/ps-park/service";

const params = Promise.resolve({ id: "bk-1" });

function makeRequest() {
  return new NextRequest("http://localhost/api/ps-park/bookings/bk-1/extend", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockExtendBooking.mockResolvedValue({ id: "bk-1", endTime: new Date("2026-06-15T13:00:00Z") });
});

describe("POST /api/ps-park/bookings/:id/extend", () => {
  it("менеджер продлевает подтверждённую бронь на час", async () => {
    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockExtendBooking).toHaveBeenCalledWith("bk-1", "mgr-1");
    expect(mockLogAudit).toHaveBeenCalledWith(
      "mgr-1",
      "booking.extend",
      "Booking",
      "bk-1",
      expect.objectContaining({ newEndTime: "2026-06-15T13:00:00.000Z" })
    );
    expect(body.success).toBe(true);
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(mockExtendBooking).not.toHaveBeenCalled();
  });

  it("не пускает обычного пользователя — 403 FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockExtendBooking).not.toHaveBeenCalled();
  });

  it("#622: менеджер без ModuleAssignment на ps-park — requireAdminSection отклоняет", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(mockExtendBooking).not.toHaveBeenCalled();
  });

  it("следующий час занят другой бронью — код ошибки сервиса прокидывается как есть", async () => {
    mockExtendBooking.mockRejectedValue(new PSBookingError("BOOKING_CONFLICT", "Следующий час занят другим бронированием"));

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BOOKING_CONFLICT");
  });

  it("неожиданная ошибка сервиса — 500, без утечки деталей", async () => {
    mockExtendBooking.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
