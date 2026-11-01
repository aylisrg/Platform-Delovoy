import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/webapp-auth", () => ({ verifyWebAppToken: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
const mockOpen = vi.fn();
vi.mock("@/modules/notifications/feed", () => ({ openFeedItem: (...a: unknown[]) => mockOpen(...a) }));

import { verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { POST } from "../route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/webapp/feed/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyWebAppToken).mockResolvedValue({ id: "u1", telegramId: "1", role: "MANAGER" });
  vi.mocked(rateLimit).mockResolvedValue(null);
  mockOpen.mockResolvedValue({ readAt: "2026-10-25T10:00:00.000Z", clicked: true });
});

describe("POST /api/webapp/feed/open (AC-D3.10)", () => {
  it("401 without a valid token", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);
    expect((await POST(request({ id: "on:a" }))).status).toBe(401);
  });

  it("happy path: user id comes from the token, never the body", async () => {
    const res = await POST(request({ id: "on:abc", actionIndex: 0 }));
    expect(res.status).toBe(200);
    expect(mockOpen).toHaveBeenCalledWith("u1", { id: "on:abc", actionIndex: 0 });
    expect((await res.json()).data).toEqual({ readAt: "2026-10-25T10:00:00.000Z", clicked: true });
  });

  it("422 on a malformed id or extra fields", async () => {
    expect((await POST(request({ id: "../etc" }))).status).toBe(422);
    expect((await POST(request({ id: "on:a", userId: "someone" }))).status).toBe(422);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
