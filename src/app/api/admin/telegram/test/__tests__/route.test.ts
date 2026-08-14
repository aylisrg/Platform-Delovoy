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

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  mockFindUnique.mockResolvedValue({ config: { telegramAdminChatId: "-100999" } });
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, result: { type: "group", title: "Admins" } }),
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/telegram/test", () => {
  it("sends a test message to the admin chat", async () => {
    const res = await POST();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // #471: session.user.name/email подставлялись в parse_mode:"HTML"
  // сообщение без экранирования.
  it("экранирует имя отправителя в тексте тестового сообщения (#471)", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: "admin-1", role: "SUPERADMIN", name: "<b>Admin</b>" },
    } as never);

    await POST();

    const tgBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(tgBody.text).toContain("&lt;b&gt;Admin&lt;/b&gt;");
    expect(tgBody.text).not.toContain("<b>Admin</b>");
  });
});
