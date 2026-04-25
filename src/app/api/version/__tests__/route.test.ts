import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      _body: body,
      async json() {
        return body;
      },
    })),
  },
}));

beforeEach(() => {
  vi.stubEnv("BUILD_GIT_SHA", "");
  vi.stubEnv("BUILD_TIME", "");
  vi.stubEnv("NODE_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("returns version from package.json", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(typeof body.version).toBe("string");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("falls back to 'unknown' when build envs are absent", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.gitSha).toBe("unknown");
    expect(body.gitShaShort).toBe("unknown");
    expect(body.buildTime).toBe("unknown");
  });

  it("surfaces gitSha and shortens it", async () => {
    vi.stubEnv("BUILD_GIT_SHA", "9277748f568542454993e740379fc902c4cabded");
    vi.stubEnv("BUILD_TIME", "2026-04-25T14:04:20Z");
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.gitSha).toBe("9277748f568542454993e740379fc902c4cabded");
    expect(body.gitShaShort).toBe("9277748");
    expect(body.buildTime).toBe("2026-04-25T14:04:20Z");
  });

  it("includes server time and uptime", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(typeof body.serverTime).toBe("string");
    expect(new Date(body.serverTime).toString()).not.toBe("Invalid Date");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
