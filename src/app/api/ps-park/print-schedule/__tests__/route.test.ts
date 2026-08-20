// issue #668: печатный лист дня — тот же гейт, что и у GET /api/ps-park/timeline.
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

const mockGetPrintableDaySchedule = vi.fn();
vi.mock("@/modules/booking/print-schedule", () => ({
  getPrintableDaySchedule: (...args: unknown[]) => mockGetPrintableDaySchedule(...args),
}));

import { GET } from "../route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/ps-park/print-schedule${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockGetPrintableDaySchedule.mockResolvedValue([]);
});

describe("GET /api/ps-park/print-schedule", () => {
  it("возвращает список для MANAGER с доступом к модулю", async () => {
    mockGetPrintableDaySchedule.mockResolvedValue([{ bookingId: "b-1" }]);

    const res = await GET(makeRequest("?date=2026-06-15"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ bookingId: "b-1" }]);
    expect(mockGetPrintableDaySchedule).toHaveBeenCalledWith("ps-park", "2026-06-15", false);
  });

  it("includeCancelled=true передаётся в сервис как true (AC-4)", async () => {
    await GET(makeRequest("?date=2026-06-15&includeCancelled=true"));

    expect(mockGetPrintableDaySchedule).toHaveBeenCalledWith("ps-park", "2026-06-15", true);
  });

  it("требует авторизацию — 401", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest("?date=2026-06-15"));

    expect(res.status).toBe(401);
    expect(mockGetPrintableDaySchedule).not.toHaveBeenCalled();
  });

  it("не пускает роль USER — 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET(makeRequest("?date=2026-06-15"));

    expect(res.status).toBe(403);
    expect(mockGetPrintableDaySchedule).not.toHaveBeenCalled();
  });

  it("уважает отказ requireAdminSection", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await GET(makeRequest("?date=2026-06-15"));

    expect(res.status).toBe(403);
    expect(mockGetPrintableDaySchedule).not.toHaveBeenCalled();
  });

  it("отклоняет некорректную дату без вызова сервиса — 422", async () => {
    const res = await GET(makeRequest("?date=not-a-date"));

    expect(res.status).toBe(422);
    expect(mockGetPrintableDaySchedule).not.toHaveBeenCalled();
  });
});
