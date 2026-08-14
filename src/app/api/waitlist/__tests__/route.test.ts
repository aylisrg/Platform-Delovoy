// @vitest-environment node
//
// #471: /api/waitlist — публичный, неаутентифицированный POST — подставлял
// name/phone в Telegram-сообщение с parse_mode:"HTML" без экранирования.
// Анонимный посетитель мог отправить <a href="...">-разметку, которая
// отрендерилась бы кликабельной в админ-чате.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    systemEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100123");
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, result: {} }),
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/waitlist", () => {
  it("queues a valid submission and notifies Telegram", async () => {
    const res = await POST(makeRequest({ name: "Иван Петров", phone: "+79991234567" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("экранирует name/phone в Telegram-сообщении — анонимный ввод (#471)", async () => {
    await POST(
      makeRequest({ name: '<a href="evil">click</a>', phone: "<b>bad</b>" })
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const tgBody = JSON.parse((init as RequestInit).body as string);
    // Канонический escapeHtml экранирует только &, <, > — кавычки не нужны.
    expect(tgBody.text).toContain('&lt;a href="evil"&gt;click&lt;/a&gt;');
    expect(tgBody.text).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(tgBody.text).not.toContain("<a href=");
    expect(tgBody.text).not.toContain("<b>bad</b>");
  });

  it("rejects invalid input without touching Telegram", async () => {
    const res = await POST(makeRequest({ name: "a", phone: "123" }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
