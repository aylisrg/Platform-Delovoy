import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTelegramApi = vi.fn();
vi.mock("@/lib/telegram/client", () => ({
  telegramApi: (...args: unknown[]) => mockTelegramApi(...args),
}));

const mockSendTransactionalEmail = vi.fn();
vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: (...args: unknown[]) => mockSendTransactionalEmail(...args),
}));

import { sendAlert } from "../notifications";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100admin");
  mockTelegramApi.mockResolvedValue({ ok: true, result: {} });
  mockSendTransactionalEmail.mockResolvedValue({ success: true });
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

describe("sendAlert — email-фолбэк для CRITICAL (issue #455)", () => {
  it("Telegram не настроен + CRITICAL_ALERT_EMAIL задан → фолбэк на email", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("CRITICAL_ALERT_EMAIL", "owner@example.com");

    const result = await sendAlert("CRITICAL", "payments", "инцидент");

    expect(result).toBe(true);
    expect(mockSendTransactionalEmail).toHaveBeenCalledOnce();
    const [params] = mockSendTransactionalEmail.mock.calls[0];
    expect(params).toMatchObject({
      to: "owner@example.com",
      subject: "[CRITICAL] payments",
    });
    expect(params.html).toContain("инцидент");
  });

  it("Telegram send вернул ok:false + email настроен → фолбэк на email", async () => {
    mockTelegramApi.mockResolvedValue({ ok: false, description: "Forbidden" });
    vi.stubEnv("CRITICAL_ALERT_EMAIL", "owner@example.com");

    const result = await sendAlert("CRITICAL", "payments", "инцидент");

    expect(result).toBe(true);
    expect(mockSendTransactionalEmail).toHaveBeenCalledOnce();
  });

  it("Telegram работает → email-фолбэк не трогаем", async () => {
    vi.stubEnv("CRITICAL_ALERT_EMAIL", "owner@example.com");

    const result = await sendAlert("CRITICAL", "payments", "инцидент");

    expect(result).toBe(true);
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("Telegram не настроен + CRITICAL_ALERT_EMAIL тоже не задан → false, email не пытается", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");

    const result = await sendAlert("CRITICAL", "payments", "инцидент");

    expect(result).toBe(false);
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("уровень не CRITICAL, Telegram не настроен → email-фолбэк не применяется", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("CRITICAL_ALERT_EMAIL", "owner@example.com");

    const result = await sendAlert("ERROR", "payments", "инцидент");

    expect(result).toBe(false);
    expect(mockSendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("email fallback сам не удался → false", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("CRITICAL_ALERT_EMAIL", "owner@example.com");
    mockSendTransactionalEmail.mockResolvedValue({ success: false, error: "SMTP down" });

    const result = await sendAlert("CRITICAL", "payments", "инцидент");

    expect(result).toBe(false);
  });

  it("sendTransactionalEmail упал (reject, не {success:false}) → sendAlert прокидывает исключение, не глотает его молча", async () => {
    // sendAlert сам не оборачивает вызов в try/catch — это делает единственный
    // сегодняшний вызывающий, alertCritical() в src/lib/logger.ts (тот же
    // контракт, что уже был у telegramApi() до этого PR). Тест фиксирует это
    // поведение явно, а не полагается на внешний try/catch молча.
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("CRITICAL_ALERT_EMAIL", "owner@example.com");
    mockSendTransactionalEmail.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(sendAlert("CRITICAL", "payments", "инцидент")).rejects.toThrow(
      "ECONNREFUSED"
    );
  });
});
