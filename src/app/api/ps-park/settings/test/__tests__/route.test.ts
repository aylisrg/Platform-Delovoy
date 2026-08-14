import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

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

vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/ps-park/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  mockFindUnique.mockResolvedValue({
    config: { telegramChannelId: "-1009876543210" },
  });
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({
      ok: true,
      result: { chat: { title: "Плей Парк — уведомления" } },
    }),
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ps-park/settings/test", () => {
  it("sends a test message to the saved channel and returns the chat title", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.chatId).toBe("-1009876543210");
    expect(body.data.chatTitle).toBe("Плей Парк — уведомления");

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const tgBody = JSON.parse((init as RequestInit).body as string);
    expect(tgBody.chat_id).toBe("-1009876543210");
    expect(tgBody.parse_mode).toBe("HTML");
  });

  it("returns NO_CHAT_ID when neither body nor config has a chat id", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NO_CHAT_ID");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // #471: имя из session.user.name подставлялось в parse_mode:"HTML"
  // сообщение без экранирования — админ с "именем" вроде <b>x</b> мог
  // сломать разметку или внедрить свою (в т.ч. фишинговую ссылку).
  it("экранирует имя пользователя в тексте тестового сообщения (#471)", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: "admin-1", role: "SUPERADMIN", name: '<a href="evil.example">Admin</a>' },
    } as never);

    await POST(makeRequest());

    const tgBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(tgBody.text).toContain('&lt;a href="evil.example"&gt;Admin&lt;/a&gt;');
    expect(tgBody.text).not.toContain("<a href=");
  });

  it("relays the Telegram error description on send failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, description: "chat not found" }),
    }) as never;

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("TELEGRAM_ERROR");
    expect(body.error.message).toBe("chat not found");
  });
});
