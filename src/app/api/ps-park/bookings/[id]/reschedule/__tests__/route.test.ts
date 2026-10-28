import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api-response", async (original) => ({ ...await original<typeof import("@/lib/api-response")>(), requireAdminSection: vi.fn() }));
vi.mock("@/modules/ps-park/reschedule", () => ({ reschedulePaidReservation: vi.fn() }));
vi.mock("@/modules/ps-park/service", () => ({ PSBookingError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("@/modules/inventory/service", () => ({ InventoryError: class extends Error {} }));
import { auth } from "@/lib/auth";
import { requireAdminSection } from "@/lib/api-response";
import { reschedulePaidReservation } from "@/modules/ps-park/reschedule";
import { PSBookingError } from "@/modules/ps-park/service";
import { POST } from "../route";
const input = { date: "2030-06-12", startTime: "12:00", expectedStartTime: "2030-06-10T07:00:00.000Z" };
function post(body: unknown = input) { return POST(new NextRequest("http://localhost/api/ps-park/bookings/b/reschedule", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "b" }) }); }
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "manager", role: "MANAGER" } } as never);
  vi.mocked(requireAdminSection).mockResolvedValue(null);
  vi.mocked(reschedulePaidReservation).mockResolvedValue({ id: "b" } as never);
});
describe("manager-assisted Play Park reschedule authorization", () => {
  it("requires authentication", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await post()).status).toBe(401);
    expect(reschedulePaidReservation).not.toHaveBeenCalled();
  });
  it("rejects customers", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "guest", role: "USER" } } as never);
    expect((await post()).status).toBe(403);
    expect(reschedulePaidReservation).not.toHaveBeenCalled();
  });
  it("rejects managers without Play Park access", async () => {
    vi.mocked(requireAdminSection).mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await post()).status).toBe(403);
    expect(requireAdminSection).toHaveBeenCalledWith(expect.anything(), "ps-park");
    expect(reschedulePaidReservation).not.toHaveBeenCalled();
  });
  it("validates dates and optimistic concurrency input", async () => {
    expect((await post({ ...input, expectedStartTime: undefined })).status).toBe(422);
    expect((await post({ ...input, startTime: "25:00" })).status).toBe(422);
    expect(reschedulePaidReservation).not.toHaveBeenCalled();
  });
  it("forwards the authenticated actor, never a client-supplied amount", async () => {
    expect((await post({ ...input, amount: 1, userId: "other" })).status).toBe(200);
    expect(reschedulePaidReservation).toHaveBeenCalledWith("b", "manager", input);
  });
  it("returns a slot conflict without hiding it behind a server error", async () => {
    vi.mocked(reschedulePaidReservation).mockRejectedValue(new PSBookingError("BOOKING_CONFLICT", "Занято"));
    expect((await (await post()).json()).error.code).toBe("BOOKING_CONFLICT");
  });
});
