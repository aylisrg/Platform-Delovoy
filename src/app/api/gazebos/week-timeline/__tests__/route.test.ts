// issue #740: недельный вид — тот же гейт, что у GET /api/gazebos/timeline, плюс рейт-лимит.
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

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockGetWeekTimeline = vi.fn();
vi.mock("@/modules/booking/week-timeline", () => ({
  getWeekTimeline: (...args: unknown[]) => mockGetWeekTimeline(...args),
}));

vi.mock("@/modules/gazebos/service", () => ({
  getOpenCloseHours: vi.fn().mockResolvedValue({ openHour: 8, closeHour: 23 }),
  getMinBookingHours: vi.fn().mockResolvedValue(2),
}));

import { GET } from "../route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/gazebos/week-timeline${query}`);
}

const WEEK = { weekStart: "2030-06-17", days: [], resources: [], bookings: [], hours: [], minBookingHours: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue(null);
  mockGetWeekTimeline.mockResolvedValue(WEEK);
});

describe("GET /api/gazebos/week-timeline", () => {
  it("MANAGER с доступом к секции получает неделю; часы и минимум — из настроек модуля", async () => {
    const res = await GET(makeRequest("?weekStart=2030-06-19"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(WEEK);
    expect(mockRequireAdminSection).toHaveBeenCalledWith(expect.anything(), "gazebos");
    expect(mockGetWeekTimeline).toHaveBeenCalledWith("gazebos", "2030-06-19", {
      openHour: 8,
      closeHour: 23,
      minBookingHours: 2,
    });
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest("?weekStart=2030-06-17"));

    expect(res.status).toBe(401);
    expect(mockGetWeekTimeline).not.toHaveBeenCalled();
  });

  it("не пускает роль USER — 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET(makeRequest("?weekStart=2030-06-17"));

    expect(res.status).toBe(403);
    expect(mockGetWeekTimeline).not.toHaveBeenCalled();
  });

  it("MANAGER без AdminPermission на секцию — 403 от requireAdminSection, а не пустая неделя (ADR §9 п.6)", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await GET(makeRequest("?weekStart=2030-06-17"));

    expect(res.status).toBe(403);
    expect(mockGetWeekTimeline).not.toHaveBeenCalled();
  });

  it("рейт-лимит authenticated по userId — 429 пробрасывается", async () => {
    mockRateLimit.mockResolvedValue(
      Response.json({ success: false, error: { code: "RATE_LIMIT", message: "Слишком много запросов" } }, { status: 429 })
    );

    const res = await GET(makeRequest("?weekStart=2030-06-17"));

    expect(res.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "mgr-1");
    expect(mockGetWeekTimeline).not.toHaveBeenCalled();
  });

  it("плохой формат даты — 422 VALIDATION_ERROR", async () => {
    const res = await GET(makeRequest("?weekStart=17.06.2030"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Формат даты: YYYY-MM-DD");
  });

  it("без weekStart — тоже 422", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(422);
  });

  it("ошибка сервиса — 500 без утечки деталей", async () => {
    mockGetWeekTimeline.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest("?weekStart=2030-06-17"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("db down");
  });
});
