import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLog, mockSendTelegramAlert, mockRedis, redisState } = vi.hoisted(() => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  };
  const mockSendTelegramAlert = vi.fn().mockResolvedValue(true);
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
  };
  const redisState = { available: true };
  return { mockLog, mockSendTelegramAlert, mockRedis, redisState };
});

vi.mock("@/lib/logger", () => ({ log: mockLog }));
vi.mock("@/lib/telegram-alert", () => ({ sendTelegramAlert: mockSendTelegramAlert }));
vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
  get redisAvailable() {
    return redisState.available;
  },
}));

import { GET } from "../route";

const PROVIDER_ENV_KEYS = [
  "NEXT_PUBLIC_TELEGRAM_BOT_NAME",
  "TELEGRAM_BOT_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  // Yandex/Google removed in Wave 1 of auth refactor (ADR 2026-04-27 §8) —
  // their flags are hard-coded to false in the route.
  "VK_CLIENT_ID",
  "VK_CLIENT_SECRET",
];

beforeEach(() => {
  vi.clearAllMocks();
  redisState.available = true;
  // Clear all provider env vars to start from a known state
  for (const key of PROVIDER_ENV_KEYS) vi.stubEnv(key, "");
  // No cooldown key set by default
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue("OK");
});

describe("GET /api/auth/providers-status", () => {
  it("reports all providers unavailable when no env vars set", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      telegram: false,
      email: false,
      yandex: false,
      google: false,
      vk: false,
    });
  });

  it("reports Telegram available when both bot name and token present", async () => {
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_NAME", "DelovoyBot");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const res = await GET();
    const body = await res.json();
    expect(body.data.telegram).toBe(true);
  });

  it("reports Telegram unavailable when only bot name present", async () => {
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_NAME", "DelovoyBot");
    const res = await GET();
    const body = await res.json();
    expect(body.data.telegram).toBe(false);
  });

  it("triggers CRITICAL log + Telegram alert when Telegram misconfigured", async () => {
    const res = await GET();
    await res.json();
    expect(mockLog.critical).toHaveBeenCalledWith(
      "auth",
      expect.stringContaining("Telegram login provider"),
      expect.objectContaining({ missingEnv: expect.any(String) })
    );
    expect(mockSendTelegramAlert).toHaveBeenCalledWith(
      expect.stringContaining("Логин сломан")
    );
  });

  it("does not alert when Telegram is configured correctly", async () => {
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_NAME", "DelovoyBot");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    await GET();
    expect(mockLog.critical).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
  });

  it("debounces repeat alerts via Redis cooldown key", async () => {
    mockRedis.get.mockResolvedValue("1");
    await GET();
    expect(mockLog.critical).not.toHaveBeenCalled();
    expect(mockSendTelegramAlert).not.toHaveBeenCalled();
  });

  it("sets Redis cooldown key after sending alert", async () => {
    await GET();
    expect(mockRedis.set).toHaveBeenCalledWith(
      "auth:alert:telegram-missing",
      "1",
      "EX",
      60 * 60
    );
  });

  it("lists missing env vars in alert metadata", async () => {
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_BOT_NAME", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await GET();
    const call = mockLog.critical.mock.calls[0];
    const metadata = call[2] as { missingEnv: string };
    expect(metadata.missingEnv).toContain("NEXT_PUBLIC_TELEGRAM_BOT_NAME");
    expect(metadata.missingEnv).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("alerts without debounce when Redis unavailable", async () => {
    redisState.available = false;
    await GET();
    expect(mockLog.critical).toHaveBeenCalled();
    expect(mockSendTelegramAlert).toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });
});
