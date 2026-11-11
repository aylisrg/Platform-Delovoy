import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api-response", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-response")>(
    "@/lib/api-response",
  )),
  requireAdminSection: vi.fn(),
}));
vi.mock("@/modules/analytics/dashboard-events", async () => ({
  ...(await vi.importActual<
    typeof import("@/modules/analytics/dashboard-events")
  >("@/modules/analytics/dashboard-events")),
  getDashboardEventStats: vi.fn(),
}));
import { requireAdminSection } from "@/lib/api-response";
import { getDashboardEventStats } from "@/modules/analytics/dashboard-events";
import { GET } from "../route";
const request = (query = "dateFrom=2026-01-01&dateTo=2026-01-07") =>
  new NextRequest(`http://localhost/api/analytics/dashboard?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminSection).mockResolvedValue(null);
});
describe("dashboard analytics access", () => {
  it("returns only aggregates under the analytics permission", async () => {
    vi.mocked(getDashboardEventStats).mockResolvedValue({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-07",
      timezone: "Europe/Moscow",
      rows: [],
    });
    expect((await GET(request())).status).toBe(200);
    expect(requireAdminSection).toHaveBeenCalledWith(undefined, "analytics");
    expect(getDashboardEventStats).toHaveBeenCalledWith(
      "2026-01-01",
      "2026-01-07",
    );
  });
  it("does not query events for users without permission", async () => {
    vi.mocked(requireAdminSection).mockResolvedValue(
      new Response(null, { status: 403 }),
    );
    expect((await GET(request())).status).toBe(403);
    expect(getDashboardEventStats).not.toHaveBeenCalled();
  });
  it("rejects malformed dates, inverted and overlong ranges", async () => {
    for (const query of [
      "dateFrom=2026-02-30&dateTo=2026-03-01",
      "dateFrom=2026-01-07&dateTo=2026-01-01",
      "dateFrom=2024-01-01&dateTo=2026-01-01",
    ])
      expect((await GET(request(query))).status).toBe(422);
    expect(getDashboardEventStats).not.toHaveBeenCalled();
  });
});
