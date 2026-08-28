import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTelegramApi = vi.fn();
vi.mock("@/lib/telegram/client", () => ({
  telegramApi: (...args: unknown[]) => mockTelegramApi(...args),
}));

import { sendAlert } from "../notifications";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100admin");
  mockTelegramApi.mockResolvedValue({ ok: true, result: {} });
});

describe("sendAlert", () => {
  it("без явного chatId шлёт в TELEGRAM_ADMIN_CHAT_ID", async () => {
    await sendAlert("CRITICAL", "payments", "инцидент");

    expect(mockTelegramApi).toHaveBeenCalledOnce();
    const [method, params] = mockTelegramApi.mock.calls[0];
    expect(method).toBe("sendMessage");
    expect(params).toMatchObject({ chat_id: "-100admin" });
  });

  it("с явным chatId шлёт туда, а не в TELEGRAM_ADMIN_CHAT_ID", async () => {
    await sendAlert("CRITICAL", "owner-decisions", "инцидент", "694696");

    const [, params] = mockTelegramApi.mock.calls[0];
    expect(params).toMatchObject({ chat_id: "694696" });
  });

  it("TELEGRAM_BOT_TOKEN не задан → false, алерт не отправлен", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");

    const result = await sendAlert("CRITICAL", "payments", "инцидент", "694696");

    expect(result).toBe(false);
    expect(mockTelegramApi).not.toHaveBeenCalled();
  });

  it("ни explicit chatId, ни TELEGRAM_ADMIN_CHAT_ID не заданы → false", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");

    const result = await sendAlert("CRITICAL", "payments", "инцидент");

    expect(result).toBe(false);
    expect(mockTelegramApi).not.toHaveBeenCalled();
  });
});
