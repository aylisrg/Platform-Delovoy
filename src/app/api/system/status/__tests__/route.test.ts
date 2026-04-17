import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/modules/monitoring/system-status-service", () => ({
  getSystemStatus: vi.fn(),
}));

vi.mock("@/lib/api-response", () => ({
  apiResponse: vi.fn((data) => ({
    status: 200,
    async json() {
      return { success: true, data };
    },
  })),
  apiUnauthorized: vi.fn(() => ({
    status: 401,
    async json() {
      return { success: false, error: { code: "UNAUTHORIZED" } };
    },
  })),
  apiForbidden: vi.fn(() => ({
    status: 403,
    async json() {
      return { success: false, error: { code: "FORBIDDEN" } };
    },
  })),
  apiServerError: vi.fn(() => ({
    status: 500,
    async json() {
      return { success: false, error: { code: "INTERNAL_ERROR" } };
    },
  })),
}));

import { GET } from "../route";
import { auth } from "@/lib/auth";
import { getSystemStatus } from "@/modules/monitoring/system-status-service";

const mockAuth = vi.mocked(auth);
const mockGetStatus = vi.mocked(getSystemStatus);

const okReport = {
  overall: "ok" as const,
  summary: "Все системы работают штатно",
  timestamp: "2026-04-16T00:00:00.000Z",
  host: { hostname: "h", platform: "Linux", uptimeSeconds: 1 },
  cpu: { status: "ok" as const, cores: 4, loadAvg1m: 0.1, loadPerCore: 0.025 },
  memory: { status: "ok" as const, totalBytes: 1, usedBytes: 0, usedPercent: 0 },
  disk: null,
  database: { status: "ok" as const, latencyMs: 1 },
  redis: { status: "ok" as const, latencyMs: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/system/status", () => {
  it("returns 401 when user is not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it("returns 403 when user role is USER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it("returns status report for SUPERADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } } as never);
    mockGetStatus.mockResolvedValue(okReport);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.overall).toBe("ok");
  });

  it("returns status report for MANAGER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "MANAGER" } } as never);
    mockGetStatus.mockResolvedValue(okReport);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockGetStatus).toHaveBeenCalled();
  });

  it("returns 500 when service throws", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPERADMIN" } } as never);
    mockGetStatus.mockRejectedValue(new Error("boom"));

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
