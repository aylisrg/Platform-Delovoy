import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/modules/profile/booking-service", () => ({
  getOwnBooking: vi.fn(),
  actOnOwnBooking: vi.fn(),
}));
vi.mock("@/modules/analytics/dashboard-events", () => ({
  recordDashboardEvent: vi.fn(),
}));
vi.mock("@/modules/gazebos/service", () => ({
  BookingError: class extends Error {},
}));
vi.mock("@/modules/ps-park/service", () => ({
  PSBookingError: class extends Error {},
}));
import { auth } from "@/lib/auth";
import {
  getOwnBooking,
  actOnOwnBooking,
} from "@/modules/profile/booking-service";
import { BookingManageError } from "@/modules/booking/manage";
import { recordDashboardEvent } from "@/modules/analytics/dashboard-events";
import { GET, POST } from "../route";
const params = Promise.resolve({ id: "b1" });
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/profile/bookings/b1", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "owner", role: "USER" },
  } as never);
});
describe("own booking API", () => {
  it("requires authentication before querying a booking", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(req(), { params })).status).toBe(401);
    expect(getOwnBooking).not.toHaveBeenCalled();
  });
  it("uses the session identity, not a submitted user id", async () => {
    vi.mocked(actOnOwnBooking).mockResolvedValue({ cancelled: true });
    expect(
      (
        await POST(
          req({ action: "cancel", confirmRefund: true, userId: "victim" }),
          { params },
        )
      ).status,
    ).toBe(200);
    expect(actOnOwnBooking).toHaveBeenCalledWith(
      "owner",
      "b1",
      { action: "cancel", confirmRefund: true },
      expect.any(Object),
    );
  });
  it("returns the same 404 for missing, deleted and other owners' bookings", async () => {
    vi.mocked(getOwnBooking).mockRejectedValue(
      new BookingManageError("NOT_FOUND", "Бронирование не найдено", 404),
    );
    expect((await GET(req(), { params })).status).toBe(404);
  });
  it("rejects payment without an explicit offer acceptance", async () => {
    expect(
      (await POST(req({ action: "pay", offerVersionSlug: "v1" }), { params }))
        .status,
    ).toBe(422);
    expect(actOnOwnBooking).not.toHaveBeenCalled();
  });
  it("does not count a penalty preview as a completed action", async () => {
    vi.mocked(actOnOwnBooking).mockResolvedValue({
      confirmationRequired: true,
      penaltyAmount: 2500,
    });
    expect((await POST(req({ action: "cancel" }), { params })).status).toBe(
      200,
    );
    expect(recordDashboardEvent).not.toHaveBeenCalled();
  });
});
