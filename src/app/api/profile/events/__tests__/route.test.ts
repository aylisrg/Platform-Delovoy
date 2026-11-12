import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/analytics/dashboard-events", async () => ({
  ...(await vi.importActual<
    typeof import("@/modules/analytics/dashboard-events")
  >("@/modules/analytics/dashboard-events")),
  recordDashboardEvent: vi.fn(),
}));
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { recordDashboardEvent } from "@/modules/analytics/dashboard-events";
import { POST } from "../route";
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/profile/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(rateLimit).mockResolvedValue(null);
});
describe("dashboard event ingest", () => {
  it("uses the authenticated owner and records only the allowlisted event", async () => {
    expect(
      (await POST(req({ event: "dashboard_section_view", section: "profile" })))
        .status,
    ).toBe(200);
    expect(recordDashboardEvent).toHaveBeenCalledWith(
      "owner",
      "dashboard_section_view",
      { section: "profile" },
    );
  });
  it("rejects anonymous and success-event injection", async () => {
    expect((await POST(req({ event: "contact_link_succeeded" }))).status).toBe(
      422,
    );
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req({ event: "dashboard_view" }))).status).toBe(401);
  });
  it("honors rate limiting", async () => {
    vi.mocked(rateLimit).mockResolvedValue(
      new Response(null, { status: 429 }) as never,
    );
    expect((await POST(req({ event: "dashboard_view" }))).status).toBe(429);
    expect(recordDashboardEvent).not.toHaveBeenCalled();
  });
});
