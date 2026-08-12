import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/webapp-auth", () => ({
  verifyWebAppToken: vi.fn(),
}));

const mockCancelGazebo = vi.fn();
vi.mock("@/modules/gazebos/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/gazebos/service")>(
    "@/modules/gazebos/service"
  );
  return {
    BookingError: actual.BookingError,
    cancelBooking: (...args: unknown[]) => mockCancelGazebo(...args),
  };
});

const mockCancelPSPark = vi.fn();
vi.mock("@/modules/ps-park/service", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ps-park/service")>(
    "@/modules/ps-park/service"
  );
  return {
    PSBookingError: actual.PSBookingError,
    cancelBooking: (...args: unknown[]) => mockCancelPSPark(...args),
  };
});

const mockLogAudit = vi.fn();
vi.mock("@/lib/logger", () => ({ logAudit: (...args: unknown[]) => mockLogAudit(...args) }));

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: vi.fn(), findMany: vi.fn() },
    resource: { findMany: vi.fn() },
  },
}));

import { verifyWebAppToken } from "@/lib/webapp-auth";
import { BookingError } from "@/modules/gazebos/service";
import { PSBookingError } from "@/modules/ps-park/service";
import { prisma } from "@/lib/db";
import { DELETE } from "../route";

const mockUser = { id: "user-1", telegramId: "tg-123", role: "USER" };

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/webapp/bookings", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
});

// #426: DELETE слал голый prisma.booking.update({status: "CANCELLED"}) в обход
// booking core — без штрафной политики, инвентаря, календаря, уведомлений,
// AuditLog. Фикс маршрутизирует на cancelBooking() модуля.
describe("DELETE /api/webapp/bookings", () => {
  it("returns 401 without valid JWT", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await DELETE(makeRequest({ bookingId: "bk-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when bookingId is missing", async () => {
    const res = await DELETE(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockCancelGazebo).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking isn't found (or isn't the caller's own)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);

    const res = await DELETE(makeRequest({ bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.code).toBe("NOT_FOUND");
    expect(mockCancelGazebo).not.toHaveBeenCalled();
    expect(mockCancelPSPark).not.toHaveBeenCalled();
  });

  it("happy path: dispatches to gazebos cancelBooking() and writes AuditLog", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "gazebos" } as never);
    mockCancelGazebo.mockResolvedValue({
      penaltyRequired: false,
      booking: { id: "bk-1", status: "CANCELLED" },
    });

    const res = await DELETE(makeRequest({ bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ id: "bk-1", status: "CANCELLED" });
    expect(mockCancelGazebo).toHaveBeenCalledWith("bk-1", "user-1", "Отменено через Mini App", false);
    expect(mockCancelPSPark).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith("user-1", "booking.cancel", "Booking", "bk-1", { source: "webapp" });
  });

  it("happy path: dispatches to ps-park cancelBooking()", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "ps-park" } as never);
    mockCancelPSPark.mockResolvedValue({
      penaltyRequired: false,
      booking: { id: "bk-2", status: "CANCELLED" },
    });

    const res = await DELETE(makeRequest({ bookingId: "bk-2" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ id: "bk-2", status: "CANCELLED" });
    expect(mockCancelPSPark).toHaveBeenCalledWith("bk-2", "user-1", "Отменено через Mini App", false);
    expect(mockCancelGazebo).not.toHaveBeenCalled();
  });

  it("rejects an unsupported module without calling any cancelBooking()", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "rental" } as never);

    const res = await DELETE(makeRequest({ bookingId: "bk-3" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("INVALID_MODULE");
    expect(mockCancelGazebo).not.toHaveBeenCalled();
    expect(mockCancelPSPark).not.toHaveBeenCalled();
  });

  it("late cancellation without confirmPenalty returns 402 and does NOT write AuditLog", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "gazebos" } as never);
    mockCancelGazebo.mockResolvedValue({
      penaltyRequired: true,
      penaltyAmount: 500,
      basePrice: 1000,
    });

    const res = await DELETE(makeRequest({ bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error.code).toBe("PENALTY_CONFIRMATION_REQUIRED");
    expect(json.error.metadata).toEqual({ penaltyAmount: 500, basePrice: 1000 });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("passes confirmPenalty through to cancelBooking() on retry", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "gazebos" } as never);
    mockCancelGazebo.mockResolvedValue({
      penaltyRequired: false,
      booking: { id: "bk-1", status: "CANCELLED" },
    });

    const res = await DELETE(makeRequest({ bookingId: "bk-1", confirmPenalty: true }));

    expect(res.status).toBe(200);
    expect(mockCancelGazebo).toHaveBeenCalledWith("bk-1", "user-1", "Отменено через Mini App", true);
  });

  it("maps FORBIDDEN from cancelBooking() (someone else's booking) to 403", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "gazebos" } as never);
    mockCancelGazebo.mockRejectedValue(
      new BookingError("FORBIDDEN", "Вы не можете отменить чужое бронирование")
    );

    const res = await DELETE(makeRequest({ bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
  });

  it("maps INVALID_STATUS_TRANSITION (already cancelled/completed) from ps-park to 409", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ moduleSlug: "ps-park" } as never);
    mockCancelPSPark.mockRejectedValue(
      new PSBookingError("INVALID_STATUS_TRANSITION", "Бронирование уже завершено или отменено")
    );

    const res = await DELETE(makeRequest({ bookingId: "bk-2" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});
