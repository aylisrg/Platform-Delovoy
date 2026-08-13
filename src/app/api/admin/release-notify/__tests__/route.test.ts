import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/release-notify", () => ({
  announceRelease: vi.fn(),
}));

vi.mock("@/lib/api-response", () => ({
  apiResponse: vi.fn((data) => ({
    status: 200,
    async json() {
      return { success: true, data };
    },
  })),
  apiError: vi.fn((code, message, status = 400) => ({
    status,
    async json() {
      return { success: false, error: { code, message } };
    },
  })),
}));

import { POST } from "../route";
import { announceRelease } from "@/modules/notifications/release-notify";

const mockAnnounce = vi.mocked(announceRelease);

const VALID_SECRET = "test-secret-abc";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/release-notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RELEASE_NOTIFY_SECRET", VALID_SECRET);
});

describe("POST /api/admin/release-notify", () => {
  it("returns 401 when secret is wrong", async () => {
    const req = makeRequest({
      secret: "wrong-secret",
      version: "1.0.0",
      commitSha: "abc1234",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("returns 503 when RELEASE_NOTIFY_SECRET is not configured", async () => {
    vi.stubEnv("RELEASE_NOTIFY_SECRET", "");

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.0.0",
      commitSha: "abc1234",
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const req = makeRequest({ secret: VALID_SECRET });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("announces the release and reports announced:true", async () => {
    mockAnnounce.mockResolvedValue({ status: "announced", queued: 3 });

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.2.0",
      releaseNotes: "- New feature",
      commitSha: "deadbeef",
      deployedAt: "2026-08-13T10:00:00.000Z",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ announced: true, queued: 3 });
    expect(mockAnnounce).toHaveBeenCalledWith({
      version: "1.2.0",
      releaseNotes: "- New feature",
      commitSha: "deadbeef",
      deployedAt: "2026-08-13T10:00:00.000Z",
    });
  });

  // Пайплайн отличает дубль от реальной отправки по `announced`, чтобы решить,
  // слать ли групповое fallback-сообщение «Deploy OK» (ADR §6.5).
  it("returns 200 with announced:false and a reason on a repeated version", async () => {
    mockAnnounce.mockResolvedValue({
      status: "skipped",
      reason: "already-announced",
    });

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.2.0",
      commitSha: "deadbeef",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      announced: false,
      queued: 0,
      skippedReason: "already-announced",
    });
  });

  it("uses empty string for releaseNotes when omitted", async () => {
    mockAnnounce.mockResolvedValue({ status: "announced", queued: 1 });

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.0.0",
      commitSha: "abc1234",
    });

    await POST(req);

    expect(mockAnnounce).toHaveBeenCalledWith(
      expect.objectContaining({ releaseNotes: "" })
    );
  });

  it("returns 500 without leaking internals when the service throws", async () => {
    mockAnnounce.mockRejectedValue(new Error("db down"));

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.0.0",
      commitSha: "abc1234",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.message).not.toContain("db down");
  });
});
