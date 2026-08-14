// #560: GET had no role check at all — any authenticated session, including
// plain USER, could pull the day's full booking timeline (PII).
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

const mockGetTimeline = vi.fn();
vi.mock("@/modules/ps-park/service", () => ({
  getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
}));

import { GET } from "../route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/ps-park/timeline${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
});

describe("GET /api/ps-park/timeline", () => {
  it("returns timeline data for a MANAGER session with section access", async () => {
    mockGetTimeline.mockResolvedValue({ resources: [], bookings: [] });

    const res = await GET(makeRequest("?date=2026-06-15"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetTimeline).toHaveBeenCalledWith("2026-06-15");
    expect(json.data).toEqual({ resources: [], bookings: [] });
  });

  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeRequest("?date=2026-06-15"));

    expect(res.status).toBe(401);
    expect(mockGetTimeline).not.toHaveBeenCalled();
  });

  it("rejects a USER-role session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET(makeRequest("?date=2026-06-15"));

    expect(res.status).toBe(403);
    expect(mockGetTimeline).not.toHaveBeenCalled();
  });

  it("respects requireAdminSection denial", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await GET(makeRequest("?date=2026-06-15"));

    expect(res.status).toBe(403);
    expect(mockGetTimeline).not.toHaveBeenCalled();
  });

  it("rejects an invalid date without calling the service", async () => {
    const res = await GET(makeRequest("?date=not-a-date"));

    expect(res.status).toBe(422);
    expect(mockGetTimeline).not.toHaveBeenCalled();
  });
});
