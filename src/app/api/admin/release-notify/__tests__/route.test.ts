import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/release-notify", () => ({
  sendReleaseNotification: vi.fn(),
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
import { sendReleaseNotification } from "@/modules/notifications/release-notify";

const mockSend = vi.mocked(sendReleaseNotification);

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
    expect(mockSend).not.toHaveBeenCalled();
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
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const req = makeRequest({ secret: VALID_SECRET });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("calls sendReleaseNotification and returns stats on success", async () => {
    mockSend.mockResolvedValue({ sent: 3, failed: 0, skipped: 0 });

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.2.0",
      releaseNotes: "- New feature",
      commitSha: "deadbeef",
      deployedAt: "2026-04-16T10:00:00.000Z",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ sent: 3, failed: 0, skipped: 0 });
    expect(mockSend).toHaveBeenCalledWith({
      version: "1.2.0",
      releaseNotes: "- New feature",
      commitSha: "deadbeef",
      deployedAt: "2026-04-16T10:00:00.000Z",
    });
  });

  it("uses empty string for releaseNotes when omitted", async () => {
    mockSend.mockResolvedValue({ sent: 1, failed: 0, skipped: 0 });

    const req = makeRequest({
      secret: VALID_SECRET,
      version: "1.0.0",
      commitSha: "abc1234",
    });

    await POST(req);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ releaseNotes: "" })
    );
  });
});
