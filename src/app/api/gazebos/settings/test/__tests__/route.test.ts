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
  return new NextRequest("http://localhost/api/gazebos/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  mockFindUnique.mockResolvedValue({
    config: { telegramChannelId: "-1001234567890" },
  });
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({
      ok: true,
      result: { chat: { title: "Барбекю — уведомления" } },
    }),
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/gazebos/settings/test", () => {
  it("sends a test message to the saved channel and returns the chat title", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.chatId).toBe("-1001234567890");
    expect(body.data.chatTitle).toBe("Барбекю — уведомления");

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/bottest-token/sendMessage");
    const tgBody = JSON.parse((init as RequestInit).body as string);
    expect(tgBody.chat_id).toBe("-1001234567890");
    expect(tgBody.parse_mode).toBe("HTML");
  });

  it("prefers the chatId from the request body over the saved one", async () => {
    const res = await POST(makeRequest({ chatId: "@gazebos_channel" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    const tgBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(tgBody.chat_id).toBe("@gazebos_channel");
  });

  it("returns NO_CHAT_ID when neither body nor config has a chat id", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NO_CHAT_ID");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns TELEGRAM_UNREACHABLE when the fetch itself fails (network timeout)", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed")) as never;

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("TELEGRAM_UNREACHABLE");
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
