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
  // Общий мок для cron- и owner-decisions-heartbeat (оба читают
  // SystemEvent.findFirst, различаясь только `where.source`) — по умолчанию
  // свежее событие, чтобы существующие тесты не знали про owner-decisions
  // check; кто хочет протухший/отсутствующий heartbeat — переопределяет сам.
  vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
    id: "ev0",
    createdAt: new Date(),
  } as never);
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

  it("probes bot token, admin chat, and owner chat concurrently, not sequentially", async () => {
    // Issue #708 / #455 п.5: три Telegram-пробы шли по очереди, и при
    // деградации транспорта (каждая проба до 5с) суммарный бюджет здоровья
    // подбирался к 15с — почти вплотную к 20с таймауту внешнего watchdog'а.
    // Если пробы параллельны, все три вызова fetch стартуют, не дожидаясь
    // резолва предыдущего.
    let callCount = 0;
    const releasers: Array<() => void> = [];
    mockFetch.mockImplementation(() => {
      callCount++;
      return new Promise((resolve) => {
        releasers.push(() => resolve({ json: async () => getMeMock }));
      });
    });

    const resultPromise = notificationsHealth();

    // Дать осесть только уже готовым микрозадачам (DB-вызов перед пробами) —
    // без реальной задержки: если бы пробы шли последовательно, здесь был бы
    // только 1 вызов fetch, а следующий начался бы лишь после его резолва.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callCount).toBe(3);

    releasers.forEach((release) => release());
    await resultPromise;
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

  describe("owner-decisions heartbeat (ADR 2026-08-24)", () => {
    it("no heartbeat + TELEGRAM_OWNER_CHAT_ID unset → ok:true (не настроено — не должно шуметь)", async () => {
      delete process.env.TELEGRAM_OWNER_CHAT_ID;
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(null);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(true);
      expect(result.checks.ownerDecisions.lastHeartbeatAt).toBeNull();
    });

    it("no heartbeat + TELEGRAM_OWNER_CHAT_ID set → ok:false (контур включён, но ни разу не отчитался)", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(null);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.reason).toMatch(/heartbeat/);
      expect(result.ok).toBe(false);
    });

    it("свежий heartbeat → ok:true", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
        id: "ev1",
        createdAt: new Date(Date.now() - 5 * 60_000),
      } as never);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(true);
      expect(result.ok).toBe(true);
    });

    it("протухший heartbeat (>40 мин) → ok:false", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
        id: "ev1",
        createdAt: new Date(Date.now() - 60 * 60_000),
      } as never);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.staleMin).toBeGreaterThanOrEqual(40);
      expect(result.ok).toBe(false);
    });
  });
});
