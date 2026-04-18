import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub env BEFORE module loads (vi.hoisted runs before imports)
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";
  process.env.TELEGRAM_OWNER_CHAT_ID = "-100owner";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "-100admin";
  process.env.NEXT_PUBLIC_APP_URL = "https://test.com";
});

// Mock prisma
const mockFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock fs
vi.mock("fs", () => ({
  readFileSync: vi.fn(() => Buffer.from("fake-image")),
  existsSync: vi.fn(() => false),
}));

import { sendUrgentFeedbackAlert } from "../telegram";

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true });
});

describe("sendUrgentFeedbackAlert", () => {
  const defaultParams = {
    feedbackId: "fb-1",
    type: "BUG" as const,
    description: "Something is broken",
    userName: "Тест Юзер",
    pageUrl: "/dashboard",
  };

  it("uses module config chat ID when available", async () => {
    mockFindUnique.mockResolvedValue({
      config: { telegramAdminChatId: "-100feedback-chat" },
    });

    await sendUrgentFeedbackAlert(defaultParams);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({
        body: expect.stringContaining("-100feedback-chat"),
      })
    );
  });

  it("falls back to OWNER_CHAT_ID when module config is empty", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });

    await sendUrgentFeedbackAlert(defaultParams);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({
        body: expect.stringContaining("-100owner"),
      })
    );
  });

  it("falls back to env when DB is unavailable", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB error"));

    await sendUrgentFeedbackAlert(defaultParams);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({
        body: expect.stringContaining("-100owner"),
      })
    );
  });

  it("sends HTML-formatted message with feedback details", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });

    await sendUrgentFeedbackAlert(defaultParams);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.parse_mode).toBe("HTML");
    expect(callBody.text).toContain("СРОЧНОЕ обращение");
    expect(callBody.text).toContain("Ошибка");
    expect(callBody.text).toContain("Тест Юзер");
  });

  it("includes admin panel link in message", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });

    await sendUrgentFeedbackAlert(defaultParams);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.text).toContain("https://test.com/admin/feedback/fb-1");
  });

  it("returns true on successful send", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });

    const result = await sendUrgentFeedbackAlert(defaultParams);

    expect(result).toBe(true);
  });

  it("returns false when Telegram API returns error", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });
    mockFetch.mockResolvedValue({ ok: false, text: () => Promise.resolve("Bad Request") });

    const result = await sendUrgentFeedbackAlert(defaultParams);

    expect(result).toBe(false);
  });

  it("truncates long descriptions to 500 chars", async () => {
    mockFindUnique.mockResolvedValue({ config: {} });
    const longDesc = "A".repeat(1000);

    await sendUrgentFeedbackAlert({ ...defaultParams, description: longDesc });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Should contain at most 500 A's
    const aCount = (callBody.text.match(/A/g) || []).length;
    expect(aCount).toBe(500);
  });
});
