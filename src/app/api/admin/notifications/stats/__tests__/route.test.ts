import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET /api/admin/notifications/stats — ADR 2026-10-25-team-access-notifications
 * §6.1/§6.2, PRD AC-D1.1 (SUPERADMIN only, period 7/30/90, default 30).
 */

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockGetStats = vi.fn();
vi.mock("@/modules/notifications/stats", () => ({
  getNotificationStats: (...args: unknown[]) => mockGetStats(...args),
}));

import { GET } from "../route";

const get = (query = "") => GET(new Request(`http://localhost/api/admin/notifications/stats${query}`));

const SUPERADMIN = { user: { id: "sa-1", role: "SUPERADMIN", adminSections: [] } };
const STATS = { period: { days: 30 }, totals: { sent: 13 } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SUPERADMIN);
  mockGetStats.mockResolvedValue(STATS);
});

describe("RBAC (AC-D1.1)", () => {
  it("401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(mockGetStats).not.toHaveBeenCalled();
  });

  it.each([
    ["ADMIN with the «Уведомления» section", { id: "adm-1", role: "ADMIN", adminSections: ["notifications"] }],
    ["MANAGER with the «Уведомления» section", { id: "m-1", role: "MANAGER", adminSections: ["notifications"] }],
    ["USER", { id: "u-1", role: "USER", adminSections: [] }],
  ])("AC-D1.1: 403 for %s", async (_label, user) => {
    mockAuth.mockResolvedValue({ user });
    const res = await get();
    expect(res.status).toBe(403);
    expect(mockGetStats).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/notifications/stats", () => {
  it("AC-D1.1: 200 for SUPERADMIN, default period 30 days", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: STATS });
    expect(mockGetStats).toHaveBeenCalledWith({ days: 30 });
  });

  it("AC-D1.1: slices are passed through validated", async () => {
    await get("?period=90&category=bookings&eventType=booking.created&channel=TELEGRAM&userId=mgr-1");
    expect(mockGetStats).toHaveBeenCalledWith({
      days: 90,
      category: "bookings",
      eventType: "booking.created",
      channel: "TELEGRAM",
      userId: "mgr-1",
    });
  });

  it.each(["?period=14", "?period=abc", "?period=", "?channel=VK", "?category=nope", "?eventType=booking.reminder"])(
    "422 for %s",
    async (query) => {
      const res = await get(query);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(mockGetStats).not.toHaveBeenCalled();
    },
  );

  it("500 without details when the service fails", async () => {
    mockGetStats.mockRejectedValue(new Error("connection refused: db:5432"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("5432");
  });
});
