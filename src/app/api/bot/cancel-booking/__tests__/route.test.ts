import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/bot-auth", () => ({
  verifyBotRequest: vi.fn(),
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
    user: { findUnique: vi.fn() },
    booking: { findUnique: vi.fn() },
  },
}));

import { verifyBotRequest } from "@/lib/bot-auth";
import { prisma } from "@/lib/db";
import { POST } from "../route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/bot/cancel-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyBotRequest).mockReturnValue(true);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
});

// #427: PENALTY_CONFIRMATION_REQUIRED уезжал в apiResponse(...) как success:true —
// бот показывал "✅ отменено" на брони, которая на самом деле осталась активной.
describe("POST /api/bot/cancel-booking", () => {
  it("returns 401 with invalid bot token", async () => {
    vi.mocked(verifyBotRequest).mockReturnValue(false);

    const res = await POST(makeRequest({ telegramId: "tg-1", bookingId: "bk-1" }));
    expect(res.status).toBe(401);
  });

  it("happy path: cancels via gazebos and writes AuditLog", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({ moduleSlug: "gazebos", userId: "user-1" } as never);
    mockCancelGazebo.mockResolvedValue({
      penaltyRequired: false,
      booking: { id: "bk-1", status: "CANCELLED" },
    });

    const res = await POST(makeRequest({ telegramId: "tg-1", bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ id: "bk-1", status: "CANCELLED" });
    expect(mockCancelGazebo).toHaveBeenCalledWith("bk-1", "user-1", "Отменено через Telegram бот", false);
    expect(mockLogAudit).toHaveBeenCalledWith("user-1", "booking.cancel", "Booking", "bk-1", {
      source: "telegram_bot",
      telegramId: "tg-1",
    });
  });

  it("late cancellation (penaltyRequired) is NOT reported as success, and does NOT write AuditLog", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({ moduleSlug: "gazebos", userId: "user-1" } as never);
    mockCancelGazebo.mockResolvedValue({
      penaltyRequired: true,
      penaltyAmount: 500,
      basePrice: 1000,
    });

    const res = await POST(makeRequest({ telegramId: "tg-1", bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("PENALTY_CONFIRMATION_REQUIRED");
    expect(json.error.metadata).toEqual({ penaltyAmount: 500, basePrice: 1000 });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("confirmPenalty: true is threaded through to cancelBooking() and succeeds", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({ moduleSlug: "ps-park", userId: "user-1" } as never);
    mockCancelPSPark.mockResolvedValue({
      penaltyRequired: false,
      booking: { id: "bk-2", status: "CANCELLED" },
    });

    const res = await POST(makeRequest({ telegramId: "tg-1", bookingId: "bk-2", confirmPenalty: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockCancelPSPark).toHaveBeenCalledWith("bk-2", "user-1", "Отменено через Telegram бот", true);
  });

  it("returns 403 for someone else's booking without calling cancelBooking()", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({ moduleSlug: "gazebos", userId: "someone-else" } as never);

    const res = await POST(makeRequest({ telegramId: "tg-1", bookingId: "bk-1" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(mockCancelGazebo).not.toHaveBeenCalled();
  });
});
