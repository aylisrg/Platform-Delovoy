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

const mockGetBooking = vi.fn();
vi.mock("@/modules/gazebos/service", () => ({
  getBooking: (...args: unknown[]) => mockGetBooking(...args),
}));

const mockGetHistory = vi.fn();
vi.mock("@/modules/booking/history", () => ({
  getBookingHistory: (...args: unknown[]) => mockGetHistory(...args),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { GET } from "../route";

const params = Promise.resolve({ id: "bk-1" });
const request = new NextRequest("http://localhost/api/gazebos/bookings/bk-1/history");

/** Закрыта час назад — окно восстановления ещё открыто. */
const closedRecently = new Date(Date.now() - 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockGetBooking.mockResolvedValue({ id: "bk-1", status: "CONFIRMED", updatedAt: closedRecently });
  mockGetHistory.mockResolvedValue([
    { id: "e1", action: "booking.create", label: "Бронь создана", actor: "Гость", at: "2026-08-01T10:00:00.000Z", details: [] },
  ]);
});

describe("GET /api/gazebos/bookings/:id/history", () => {
  it("отдаёт ленту событий менеджеру своего раздела", async () => {
    const res = await GET(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.events).toHaveLength(1);
    expect(mockGetHistory).toHaveBeenCalledWith("bk-1", "gazebos");
  });

  it("требует авторизацию", async () => {
    mockAuth.mockResolvedValue(null);

    expect((await GET(request, { params })).status).toBe(401);
  });

  it("не отдаёт историю обычному пользователю", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u-1", role: "USER" } });

    expect((await GET(request, { params })).status).toBe(403);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("уважает ограничение по разделу для менеджера чужого модуля (AC-4)", async () => {
    mockRequireAdminSection.mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 403 })
    );

    expect((await GET(request, { params })).status).toBe(403);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("404 для несуществующей брони", async () => {
    mockGetBooking.mockResolvedValue(null);

    expect((await GET(request, { params })).status).toBe(404);
  });

  it("менеджеру кнопку восстановления не предлагает даже у закрытой брони", async () => {
    mockGetBooking.mockResolvedValue({ id: "bk-1", status: "COMPLETED", updatedAt: closedRecently });

    const body = await (await GET(request, { params })).json();

    expect(body.data.restore.available).toBe(false);
    expect(body.data.restore.reasonUnavailable).toContain("суперадмин");
  });

  it("суперадмину у свежезакрытой брони открывает восстановление с остатком окна", async () => {
    mockAuth.mockResolvedValue({ user: { id: "su-1", role: "SUPERADMIN" } });
    mockGetBooking.mockResolvedValue({ id: "bk-1", status: "CANCELLED", updatedAt: closedRecently });

    const body = await (await GET(request, { params })).json();

    expect(body.data.restore.available).toBe(true);
    expect(body.data.restore.hoursLeft).toBeGreaterThan(0);
  });

  it("после истечения окна восстановление недоступно и суперадмину (AC-2)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "su-1", role: "SUPERADMIN" } });
    mockGetBooking.mockResolvedValue({
      id: "bk-1",
      status: "COMPLETED",
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    const body = await (await GET(request, { params })).json();

    expect(body.data.restore.available).toBe(false);
    expect(body.data.restore.reasonUnavailable).toContain("истекло");
  });

  it("у активной брони восстанавливать нечего", async () => {
    mockAuth.mockResolvedValue({ user: { id: "su-1", role: "SUPERADMIN" } });

    const body = await (await GET(request, { params })).json();

    expect(body.data.restore.available).toBe(false);
    expect(body.data.restore.reasonUnavailable).toBe("Бронь не закрыта");
  });
});
