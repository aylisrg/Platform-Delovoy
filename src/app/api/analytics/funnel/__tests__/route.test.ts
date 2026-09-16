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

const mockGetFunnelStats = vi.fn();
vi.mock("@/modules/analytics/product-events", () => ({
  getFunnelStats: (...args: unknown[]) => mockGetFunnelStats(...args),
}));

import { GET } from "../route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/analytics/funnel${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
  mockRequireAdminSection.mockResolvedValue(null);
});

describe("GET /api/analytics/funnel", () => {
  it("отдаёт агрегацию за валидный период", async () => {
    mockGetFunnelStats.mockResolvedValue({ period: { dateFrom: "2026-09-01", dateTo: "2026-09-07" }, funnels: [] });

    const res = await GET(makeRequest("?dateFrom=2026-09-01&dateTo=2026-09-07"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockGetFunnelStats).toHaveBeenCalledWith({ dateFrom: "2026-09-01", dateTo: "2026-09-07" });
  });

  it("требует сессию — без auth возвращает отказ, сервис не вызывается", async () => {
    mockAuth.mockResolvedValue(null);
    mockRequireAdminSection.mockResolvedValue(new Response(null, { status: 401 }) as never);

    const res = await GET(makeRequest("?dateFrom=2026-09-01&dateTo=2026-09-07"));
    expect(res.status).toBe(401);
    expect(mockGetFunnelStats).not.toHaveBeenCalled();
  });

  it("невалидный период (dateFrom > dateTo) — 422, сервис не вызывается", async () => {
    const res = await GET(makeRequest("?dateFrom=2026-09-07&dateTo=2026-09-01"));
    expect(res.status).toBe(422);
    expect(mockGetFunnelStats).not.toHaveBeenCalled();
  });

  it("неожиданная ошибка сервиса — 500 без утечки деталей", async () => {
    mockGetFunnelStats.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest("?dateFrom=2026-09-01&dateTo=2026-09-07"));
    expect(res.status).toBe(500);
  });
});
