// #560: GET had no role check at all — any authenticated session, including
// plain USER, could poll currently-active sessions (client PII).
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockGetActiveSessions = vi.fn();
vi.mock("@/modules/ps-park/service", () => ({
  getActiveSessions: (...args: unknown[]) => mockGetActiveSessions(...args),
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "mgr-1", role: "MANAGER" } });
  mockRequireAdminSection.mockResolvedValue(null);
});

describe("GET /api/ps-park/active-sessions", () => {
  it("returns active sessions for a MANAGER session with section access", async () => {
    mockGetActiveSessions.mockResolvedValue([{ id: "s1" }]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ id: "s1" }]);
  });

  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockGetActiveSessions).not.toHaveBeenCalled();
  });

  it("rejects a USER-role session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "USER" } });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mockGetActiveSessions).not.toHaveBeenCalled();
  });

  it("respects requireAdminSection denial", async () => {
    mockRequireAdminSection.mockResolvedValue(
      Response.json({ success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } }, { status: 403 })
    );

    const res = await GET();

    expect(res.status).toBe(403);
    expect(mockGetActiveSessions).not.toHaveBeenCalled();
  });
});
