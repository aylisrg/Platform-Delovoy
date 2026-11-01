import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET /api/users/[id]/notification-stats — ADR 2026-10-25-team-access-notifications
 * §6.1/§6.2, PRD US-D2 (SUPERADMIN only; period 7/30/90, default 30).
 */

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockGetUserStats = vi.fn();
vi.mock("@/modules/notifications/stats", () => ({
  getUserNotificationStats: (...args: unknown[]) => mockGetUserStats(...args),
}));

import { GET } from "../route";
import { NotificationDomainError } from "@/modules/notifications/errors";

const get = (query = "", id = "mgr-1") =>
  GET(new Request(`http://localhost/api/users/${id}/notification-stats${query}`), {
    params: Promise.resolve({ id }),
  });

const SUPERADMIN = { user: { id: "sa-1", role: "SUPERADMIN", adminSections: [] } };
const STATS = { period: { days: 30 }, totals: { sent: 13 }, recent: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SUPERADMIN);
  mockGetUserStats.mockResolvedValue(STATS);
});

describe("RBAC", () => {
  it("401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(mockGetUserStats).not.toHaveBeenCalled();
  });

  it.each([
    ["ADMIN with the «Пользователи» section", { id: "adm-1", role: "ADMIN", adminSections: ["users"] }],
    ["MANAGER with the «Пользователи» section", { id: "m-1", role: "MANAGER", adminSections: ["users"] }],
    ["USER asking for own stats", { id: "mgr-1", role: "USER", adminSections: [] }],
  ])("403 for %s", async (_label, user) => {
    mockAuth.mockResolvedValue({ user });
    const res = await get();
    expect(res.status).toBe(403);
    expect(mockGetUserStats).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/[id]/notification-stats", () => {
  it("AC-D2.1: 200 for SUPERADMIN, default period 30", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: STATS });
    expect(mockGetUserStats).toHaveBeenCalledWith("mgr-1", 30);
  });

  it.each([
    ["?period=7", 7],
    ["?period=90", 90],
  ])("AC-D2.1: %s", async (query, days) => {
    await get(query);
    expect(mockGetUserStats).toHaveBeenCalledWith("mgr-1", days);
  });

  it.each(["?period=14", "?period=abc", "?period="])("422 for %s", async (query) => {
    const res = await get(query);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mockGetUserStats).not.toHaveBeenCalled();
  });

  it("422 for an over-long id", async () => {
    const res = await get("", "x".repeat(65));
    expect(res.status).toBe(422);
    expect(mockGetUserStats).not.toHaveBeenCalled();
  });

  it("404 USER_NOT_FOUND", async () => {
    mockGetUserStats.mockRejectedValue(new NotificationDomainError("USER_NOT_FOUND", "Пользователь не найден", 404));
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "USER_NOT_FOUND", message: "Пользователь не найден" });
  });

  it("500 without details on unexpected errors", async () => {
    mockGetUserStats.mockRejectedValue(new Error("boom: secret detail"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
