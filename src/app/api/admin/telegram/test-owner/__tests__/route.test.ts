import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => ({
    user: { id: "admin-1", role: "SUPERADMIN", name: "Admin" },
  })),
}));

vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: vi.fn(() => null),
  };
});

import { POST } from "../route";

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_OWNER_CHAT_ID", "12345");
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, result: { chat: { first_name: "Owner" } } }),
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/telegram/test-owner", () => {
  it("sends a test message to the owner's private chat", async () => {
    const res = await POST();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects non-SUPERADMIN roles", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: "manager-1", role: "MANAGER", name: "Manager" },
    } as never);

    const res = await POST();
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // #471: senderName подставлялось в parse_mode:"HTML" сообщение без
  // экранирования.
  it("экранирует имя отправителя в тексте тестового сообщения (#471)", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: "admin-1", role: "SUPERADMIN", name: "<b>Owner</b>" },
    } as never);

    await POST();

    const tgBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(tgBody.text).toContain("&lt;b&gt;Owner&lt;/b&gt;");
    expect(tgBody.text).not.toContain("<b>Owner</b>");
  });
});
