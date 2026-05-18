import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
    outgoingNotification: { count: vi.fn() },
    systemEvent: { findFirst: vi.fn() },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma } from "@/lib/db";
import { notificationsHealth } from "../health";

const getMeMock = { ok: true, result: { username: "DelovoyPark_bot" } };
const getChatMock = { ok: true, result: { title: "Деловой Парк Администраторы" } };

function setupFetch(responses: Record<string, object>) {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [key, body] of Object.entries(responses)) {
      if (String(url).includes(key)) {
        return { json: async () => body };
      }
    }
    return { json: async () => ({ ok: false, description: "not found" }) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "-100admingroup";
  process.env.TELEGRAM_OWNER_CHAT_ID = "1234owner";

  vi.mocked(prisma.module.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.outgoingNotification.count).mockResolvedValue(0);
  vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(null);
});

describe("notificationsHealth", () => {
  it("returns ok=true when bot reachable, chats accessible, queue clean", async () => {
    setupFetch({ getMe: getMeMock, getChat: getChatMock });

    const result = await notificationsHealth();

    expect(result.ok).toBe(true);
    expect(result.checks.botToken.ok).toBe(true);
    expect(result.checks.botToken.username).toBe("DelovoyPark_bot");
    expect(result.checks.adminChat.ok).toBe(true);
    expect(result.checks.adminChat.title).toBe("Деловой Парк Администраторы");
    expect(result.checks.ownerChat.ok).toBe(true);
    expect(result.checks.queue.pending).toBe(0);
    expect(result.checks.queue.failedLastHour).toBe(0);
  });

  it("returns ok=false when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    const result = await notificationsHealth();

    expect(result.ok).toBe(false);
    expect(result.checks.botToken.ok).toBe(false);
    expect(result.checks.botToken.reason).toMatch(/not set/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns ok=false when getMe fails (invalid token)", async () => {
    setupFetch({ getMe: { ok: false, description: "Unauthorized" } });

    const result = await notificationsHealth();

    expect(result.ok).toBe(false);
    expect(result.checks.botToken.ok).toBe(false);
    expect(result.checks.botToken.reason).toBe("Unauthorized");
  });

  it("returns ok=false when getChat fails for admin chat (bot kicked)", async () => {
    setupFetch({
      getMe: getMeMock,
      getChat: { ok: false, description: "chat not found" },
    });

    const result = await notificationsHealth();

    expect(result.ok).toBe(false);
    expect(result.checks.adminChat.ok).toBe(false);
    expect(result.checks.adminChat.reason).toBe("chat not found");
  });

  it("returns ok=false when TELEGRAM_ADMIN_CHAT_ID is missing", async () => {
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
    setupFetch({ getMe: getMeMock });

    const result = await notificationsHealth();

    expect(result.ok).toBe(false);
    expect(result.checks.adminChat.ok).toBe(false);
    expect(result.checks.adminChat.reason).toMatch(/not set/);
  });

  it("returns ok=false when failedLastHour > 0", async () => {
    setupFetch({ getMe: getMeMock, getChat: getChatMock });
    vi.mocked(prisma.outgoingNotification.count)
      .mockResolvedValueOnce(3)  // pending
      .mockResolvedValueOnce(5); // failedLastHour

    const result = await notificationsHealth();

    expect(result.ok).toBe(false);
    expect(result.checks.queue.pending).toBe(3);
    expect(result.checks.queue.failedLastHour).toBe(5);
  });

  it("includes cron heartbeat when SystemEvent exists", async () => {
    setupFetch({ getMe: getMeMock, getChat: getChatMock });
    const past = new Date(Date.now() - 3 * 60_000); // 3 minutes ago
    vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
      id: "ev1",
      createdAt: past,
    } as never);

    const result = await notificationsHealth();

    expect(result.checks.cron.lastRunAt).toBe(past.toISOString());
    expect(result.checks.cron.staleMin).toBeGreaterThanOrEqual(2);
    expect(result.checks.cron.staleMin).toBeLessThan(5);
  });

  it("still returns data when DB is unavailable (queue/cron checks fail gracefully)", async () => {
    setupFetch({ getMe: getMeMock, getChat: getChatMock });
    vi.mocked(prisma.outgoingNotification.count).mockRejectedValue(new Error("DB down"));
    vi.mocked(prisma.systemEvent.findFirst).mockRejectedValue(new Error("DB down"));

    const result = await notificationsHealth();

    expect(result.checks.botToken.ok).toBe(true);
    expect(result.checks.queue.pending).toBe(0);
    expect(result.checks.queue.failedLastHour).toBe(0);
    expect(result.checks.cron.lastRunAt).toBeNull();
  });
});
