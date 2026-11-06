import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
    outgoingNotification: { count: vi.fn() },
    systemEvent: { findFirst: vi.fn() },
  },
}));

const redisState = { available: true };
const redisSetMock = vi.fn();
const redisIncrMock = vi.fn();
const redisExpireMock = vi.fn();
const redisDelMock = vi.fn();
const redisLrangeMock = vi.fn();
const redisLindexMock = vi.fn();
const redisLpushMock = vi.fn();
const redisLtrimMock = vi.fn();
vi.mock("@/lib/redis", () => ({
  redis: {
    set: (...args: unknown[]) => redisSetMock(...args),
    incr: (...args: unknown[]) => redisIncrMock(...args),
    expire: (...args: unknown[]) => redisExpireMock(...args),
    del: (...args: unknown[]) => redisDelMock(...args),
    lrange: (...args: unknown[]) => redisLrangeMock(...args),
    lindex: (...args: unknown[]) => redisLindexMock(...args),
    lpush: (...args: unknown[]) => redisLpushMock(...args),
    ltrim: (...args: unknown[]) => redisLtrimMock(...args),
  },
  get redisAvailable() {
    return redisState.available;
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma } from "@/lib/db";
import {
  OWNER_DECISIONS_MIN_MISSED_TICKS,
  OWNER_DECISIONS_STALE_MINUTES,
  TELEGRAM_TRANSPORT_FLAP_STREAK,
  notificationsHealth,
  recordSchedulerTick,
  shouldAlertOwnerDecisionsSilence,
} from "../health";

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

  redisSetMock.mockReset();
  redisSetMock.mockResolvedValue("OK");
  redisIncrMock.mockReset();
  redisIncrMock.mockResolvedValue(1);
  redisExpireMock.mockReset();
  redisExpireMock.mockResolvedValue(1);
  redisDelMock.mockReset();
  redisDelMock.mockResolvedValue(1);
  // По умолчанию тиков планировщика нет — owner-decisions судится по часам,
  // как до инцидента 2026-11-06; тесты тиков задают список сами.
  redisLrangeMock.mockReset();
  redisLrangeMock.mockResolvedValue([]);
  redisLindexMock.mockReset();
  redisLindexMock.mockResolvedValue(null);
  redisLpushMock.mockReset();
  redisLpushMock.mockResolvedValue(1);
  redisLtrimMock.mockReset();
  redisLtrimMock.mockResolvedValue("OK");
  redisState.available = true;

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

  it("#917: ok=false when process-outgoing cron is silent and overdue messages exist", async () => {
    setupFetch({ getMe: getMeMock, getChat: getChatMock });
    vi.mocked(prisma.outgoingNotification.count)
      .mockResolvedValueOnce(19) // pending
      .mockResolvedValueOnce(0) // failedLastHour
      .mockResolvedValueOnce(19); // overdue
    vi.mocked(prisma.systemEvent.findFirst).mockImplementation((async (args: { where: { source: string } }) =>
      args.where.source === "cron.processOutgoing" ? null : { id: "hb", createdAt: new Date() }) as never);

    const result = await notificationsHealth();

    expect(result.ok).toBe(false);
    expect(result.checks.queue.overdue).toBe(19);
    expect(result.checks.cron.ok).toBe(false);
    expect(result.checks.cron.reason).toContain("19");
  });

  it("#917: silent cron with an empty queue does not fail health", async () => {
    setupFetch({ getMe: getMeMock, getChat: getChatMock });
    vi.mocked(prisma.systemEvent.findFirst).mockImplementation((async (args: { where: { source: string } }) =>
      args.where.source === "cron.processOutgoing" ? null : { id: "hb", createdAt: new Date() }) as never);

    const result = await notificationsHealth();

    expect(result.ok).toBe(true);
    expect(result.checks.cron.ok).toBeUndefined();
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

  describe("транспортные флапы Telegram-проб — повтор и гистерезис (issue #708)", () => {
    /** fetch: URL с ключом из `flaky` падает транспортом первые `times` раз, дальше — как обычно. */
    function setupFlakyFetch(flaky: Record<string, number>, responses: Record<string, object>) {
      const left = { ...flaky };
      mockFetch.mockImplementation(async (url: string) => {
        for (const key of Object.keys(left)) {
          if (String(url).includes(key) && left[key] > 0) {
            left[key]--;
            throw new TypeError("fetch failed");
          }
        }
        for (const [key, body] of Object.entries(responses)) {
          if (String(url).includes(key)) return { json: async () => body };
        }
        return { json: async () => ({ ok: false, description: "not found" }) };
      });
    }
    const calls = (key: string) => mockFetch.mock.calls.filter(([u]) => String(u).includes(key)).length;

    it("транспортный сбой → одна повторная попытка; успех со второго раза → ok:true, серия сброшена", async () => {
      setupFlakyFetch({ getMe: 1 }, { getMe: getMeMock, getChat: getChatMock });

      const result = await notificationsHealth();

      expect(result.ok).toBe(true);
      expect(result.degraded).toBeUndefined();
      expect(result.checks.botToken).toMatchObject({ ok: true, username: "DelovoyPark_bot" });
      expect(calls("getMe")).toBe(2);
      expect(redisIncrMock).not.toHaveBeenCalled();
      expect(redisDelMock).toHaveBeenCalledOnce();
    });

    it("сбой и после повтора, серия 1 из 3 → ok:true с degraded, проба помечена transportError", async () => {
      setupFlakyFetch({ getChat: 10 }, { getMe: getMeMock });
      redisIncrMock.mockResolvedValue(1);

      const result = await notificationsHealth();

      expect(result.ok).toBe(true);
      expect(result.degraded).toMatchObject({ flapStreak: 1, failedProbes: ["adminChat", "ownerChat"] });
      expect(result.degraded?.reason).toContain("серия 1 из 3");
      expect(result.checks.adminChat).toMatchObject({ ok: false, transportError: true });
      expect(result.checks.adminChat.reason).toMatch(/fetch failed/);
      expect(redisIncrMock).toHaveBeenCalledWith("notifications:health:telegram-transport-flap-streak");
      expect(redisExpireMock).toHaveBeenCalledWith("notifications:health:telegram-transport-flap-streak", 30 * 60);
      expect(redisDelMock).not.toHaveBeenCalled();
    });

    it("серия дошла до порога → ok:false: настоящий обрыв остаётся инцидентом", async () => {
      setupFlakyFetch({ getMe: 10 }, { getChat: getChatMock });
      redisIncrMock.mockResolvedValue(TELEGRAM_TRANSPORT_FLAP_STREAK);

      const result = await notificationsHealth();

      expect(result.ok).toBe(false);
      expect(result.degraded).toBeUndefined();
      expect(result.checks.botToken.ok).toBe(false);
    });

    it("ошибка API (Unauthorized) — не транспорт: без повтора и без гистерезиса, ok:false сразу", async () => {
      setupFetch({ getMe: { ok: false, description: "Unauthorized" }, getChat: getChatMock });

      const result = await notificationsHealth();

      expect(result.ok).toBe(false);
      expect(result.checks.botToken.transportError).toBeFalsy();
      expect(calls("getMe")).toBe(1);
      expect(redisIncrMock).not.toHaveBeenCalled();
    });

    it("смешанный отказ (транспорт + «chat not found») — серия не считается, ok:false", async () => {
      setupFlakyFetch({ getMe: 10 }, { getChat: { ok: false, description: "chat not found" } });

      const result = await notificationsHealth();

      expect(result.ok).toBe(false);
      expect(redisIncrMock).not.toHaveBeenCalled();
    });

    it("Redis недоступен → гистерезиса нет, поведение прежнее (ok:false)", async () => {
      redisState.available = false;
      setupFlakyFetch({ getMe: 10 }, { getChat: getChatMock });

      const result = await notificationsHealth();

      expect(result.ok).toBe(false);
      expect(redisIncrMock).not.toHaveBeenCalled();
    });

    it("Redis упал на INCR → ok:false, ошибка не пробрасывается", async () => {
      redisIncrMock.mockRejectedValue(new Error("ECONNRESET"));
      setupFlakyFetch({ getMe: 10 }, { getChat: getChatMock });

      await expect(notificationsHealth()).resolves.toMatchObject({ ok: false });
    });

    it("здоровые пробы при упавшем DEL — ok:true, ошибка Redis проглочена", async () => {
      redisDelMock.mockRejectedValue(new Error("ECONNRESET"));
      setupFetch({ getMe: getMeMock, getChat: getChatMock });

      await expect(notificationsHealth()).resolves.toMatchObject({ ok: true });
    });
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

    it("heartbeat 4 часа назад — обычная задержка cron в GitHub (инцидент 2026-09-03) → ok:true", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
        id: "ev1",
        createdAt: new Date(Date.now() - 4 * 60 * 60_000),
      } as never);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(true);
      expect(result.checks.ownerDecisions.reason).toBeUndefined();
      expect(result.ok).toBe(true);
    });

    it("порог — 6 часов: дольше худшей замеренной дыры планировщика (261 мин)", () => {
      expect(OWNER_DECISIONS_STALE_MINUTES).toBe(360);
    });

    it("протухший heartbeat (старше порога) → ok:false с причиной", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
        id: "ev1",
        createdAt: new Date(Date.now() - (OWNER_DECISIONS_STALE_MINUTES + 30) * 60_000),
      } as never);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.staleMin).toBeGreaterThanOrEqual(OWNER_DECISIONS_STALE_MINUTES);
      expect(result.checks.ownerDecisions.reason).toMatch(/heartbeat старше 360 мин/);
      expect(result.ok).toBe(false);
    });
  });

  describe("owner-decisions: протухание по тикам планировщика GitHub (инцидент 2026-11-06)", () => {
    const HOUR = 60 * 60_000;
    const staleHeartbeat = () => ({
      id: "hb",
      createdAt: new Date(Date.now() - (OWNER_DECISIONS_STALE_MINUTES + 31) * 60_000),
    });
    /** Тики в списке Redis — новые первыми, как кладёт LPUSH. */
    const ticksAt = (...msAgo: number[]) => msAgo.map((ago) => String(Date.now() - ago));

    it("порог — 2 пропущенных тика: 0 и 1 бывают от гонки внутри пачки и одной выпавшей пачки", () => {
      expect(OWNER_DECISIONS_MIN_MISSED_TICKS).toBe(2);
    });

    it("протух по часам, но после heartbeat не было ни одного тика → cron отстаёт, ok:true + schedulerLag", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(staleHeartbeat() as never);
      // Прошлая пачка: watchdog опросил health за секунды ДО свипера — тик старше heartbeat.
      redisLrangeMock.mockResolvedValue(ticksAt(7 * HOUR, 14 * HOUR));

      const result = await notificationsHealth();

      expect(redisLrangeMock).toHaveBeenCalledWith("notifications:health:scheduler-ticks", 0, 9);
      expect(result.checks.ownerDecisions.ok).toBe(true);
      expect(result.checks.ownerDecisions.reason).toBeUndefined();
      expect(result.checks.ownerDecisions.schedulerTicksSinceHeartbeat).toBe(0);
      expect(result.checks.ownerDecisions.schedulerLag?.lastTickAt).toBe(
        new Date(Number(ticksAt(7 * HOUR)[0])).toISOString()
      );
      expect(result.ok).toBe(true);
    });

    it("один тик после heartbeat (выпала одна пачка свипера) → ещё не алерт", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(staleHeartbeat() as never);
      redisLrangeMock.mockResolvedValue(ticksAt(1 * HOUR, 8 * HOUR));

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(true);
      expect(result.checks.ownerDecisions.schedulerTicksSinceHeartbeat).toBe(1);
      expect(result.checks.ownerDecisions.schedulerLag).toBeDefined();
    });

    it("два тика после heartbeat — планировщик работал, а свипер молчал → ok:false с числом тиков", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(staleHeartbeat() as never);
      redisLrangeMock.mockResolvedValue(ticksAt(5 * 60_000, 10 * 60_000, 8 * HOUR));

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.schedulerTicksSinceHeartbeat).toBe(2);
      expect(result.checks.ownerDecisions.schedulerLag).toBeUndefined();
      expect(result.checks.ownerDecisions.reason).toMatch(/heartbeat старше 360 мин/);
      expect(result.ok).toBe(false);
    });

    it("тиков ещё нет (заголовок не задеплоен / Redis очищен) → судим по часам: ok:false", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(staleHeartbeat() as never);
      redisLrangeMock.mockResolvedValue([]);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.schedulerTicksSinceHeartbeat).toBeUndefined();
    });

    it("Redis недоступен → fail-open к порогу по часам: ok:false, Redis не трогаем", async () => {
      redisState.available = false;
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(staleHeartbeat() as never);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(redisLrangeMock).not.toHaveBeenCalled();
    });

    it("Redis упал на LRANGE → fail-open: ok:false, ошибку не пробрасываем", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(staleHeartbeat() as never);
      redisLrangeMock.mockRejectedValue(new Error("ECONNRESET"));

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.reason).toMatch(/heartbeat старше/);
    });

    it("свежий heartbeat — тики не читаем вовсе", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue({
        id: "hb",
        createdAt: new Date(Date.now() - 5 * 60_000),
      } as never);

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(true);
      expect(result.checks.ownerDecisions.schedulerLag).toBeUndefined();
      expect(redisLrangeMock).not.toHaveBeenCalled();
    });

    it("heartbeat ни разу не был — тики не спасают: контур не настроен, это не задержка", async () => {
      setupFetch({ getMe: getMeMock, getChat: getChatMock });
      vi.mocked(prisma.systemEvent.findFirst).mockResolvedValue(null);
      redisLrangeMock.mockResolvedValue(ticksAt(8 * HOUR));

      const result = await notificationsHealth();

      expect(result.checks.ownerDecisions.ok).toBe(false);
      expect(result.checks.ownerDecisions.reason).toMatch(/ни разу/);
    });
  });

  describe("recordSchedulerTick", () => {
    const NOW = Date.parse("2026-11-06T15:22:13.000Z");

    it("пишет тик: LPUSH + LTRIM до 10 + TTL неделя", async () => {
      await recordSchedulerTick(NOW);

      expect(redisLpushMock).toHaveBeenCalledWith("notifications:health:scheduler-ticks", String(NOW));
      expect(redisLtrimMock).toHaveBeenCalledWith("notifications:health:scheduler-ticks", 0, 9);
      expect(redisExpireMock).toHaveBeenCalledWith("notifications:health:scheduler-ticks", 7 * 24 * 60 * 60);
    });

    it("повтор того же прогона watchdog'а (через 10 с) — тот же тик, не пишем", async () => {
      redisLindexMock.mockResolvedValue(String(NOW - 10_000));

      await recordSchedulerTick(NOW);

      expect(redisLpushMock).not.toHaveBeenCalled();
    });

    it("следующий прогон (через 5 мин) — новый тик", async () => {
      redisLindexMock.mockResolvedValue(String(NOW - 5 * 60_000));

      await recordSchedulerTick(NOW);

      expect(redisLpushMock).toHaveBeenCalledTimes(1);
    });

    it("Redis недоступен — молча ничего", async () => {
      redisState.available = false;

      await expect(recordSchedulerTick(NOW)).resolves.toBeUndefined();
      expect(redisLindexMock).not.toHaveBeenCalled();
      expect(redisLpushMock).not.toHaveBeenCalled();
    });

    it("Redis упал — ошибку не пробрасываем", async () => {
      redisLpushMock.mockRejectedValue(new Error("ECONNRESET"));

      await expect(recordSchedulerTick(NOW)).resolves.toBeUndefined();
    });
  });

  describe("реплей реального таймлайна 2026-11-02..06 (cron GitHub пачками раз в 4–8 ч)", () => {
    // Прогоны из GitHub Actions API: site-watchdog.yml (опрос health ≈ старт + 10 с)
    // и issue-queue-merge.yml (heartbeat ≈ старт + 35 с). Старый порог по часам
    // дал на этом отрезке 6 ложных CRITICAL и 503 → notifications-down.
    const WATCHDOG_RUNS = [
      "2026-11-02T23:40:18Z", "2026-11-03T04:01:19Z", "2026-11-03T11:49:04Z", "2026-11-03T18:40:19Z",
      "2026-11-03T23:40:46Z", "2026-11-04T03:16:33Z", "2026-11-04T11:04:23Z", "2026-11-04T18:34:55Z",
      "2026-11-04T23:53:51Z", "2026-11-05T04:12:30Z", "2026-11-05T12:20:07Z", "2026-11-05T20:06:06Z",
      "2026-11-06T00:56:30Z", "2026-11-06T07:38:12Z", "2026-11-06T15:22:13Z",
    ];
    const SWEEPER_RUNS = [
      "2026-11-02T16:43:57Z", "2026-11-02T23:41:12Z", "2026-11-03T04:01:25Z", "2026-11-03T11:53:27Z",
      "2026-11-03T18:55:19Z", "2026-11-03T23:50:07Z", "2026-11-04T04:24:28Z", "2026-11-04T12:22:02Z",
      "2026-11-04T19:56:17Z", "2026-11-05T00:42:46Z", "2026-11-05T07:25:34Z", "2026-11-05T15:40:55Z",
      "2026-11-05T21:33:46Z", "2026-11-06T01:47:33Z", "2026-11-06T08:50:34Z",
    ];

    /** Прогоняет таймлайн; возвращает моменты опросов watchdog'а, где контур признан молчащим. */
    async function replay(sweeperDeadAfter?: string): Promise<{ at: string; wallClockStale: boolean; ok: boolean }[]> {
      const events = [
        ...WATCHDOG_RUNS.map((t) => ({ at: Date.parse(t) + 10_000, kind: "watchdog" as const })),
        ...SWEEPER_RUNS.map((t) => ({ at: Date.parse(t) + 35_000, kind: "sweeper" as const })),
      ].sort((a, b) => a.at - b.at);
      const deadAfter = sweeperDeadAfter ? Date.parse(sweeperDeadAfter) : Infinity;

      // Список тиков уже прогрет: предыдущий прогон watchdog'а (2026-11-02 16:38,
      // run #9698). Холодный список = откат к порогу по часам — отдельный тест выше.
      const ticks: string[] = [String(Date.parse("2026-11-02T16:38:00Z") + 10_000)];
      redisLrangeMock.mockImplementation(async () => [...ticks]);
      redisLindexMock.mockImplementation(async () => ticks[0] ?? null);
      redisLpushMock.mockImplementation(async (_key: string, value: string) => ticks.unshift(value));
      redisLtrimMock.mockImplementation(async () => {
        ticks.splice(10);
        return "OK";
      });
      let heartbeat = new Date(SWEEPER_RUNS[0]);
      vi.mocked(prisma.systemEvent.findFirst).mockImplementation((async (args: { where: { source: string } }) =>
        args.where.source === "owner-decisions"
          ? { id: "hb", createdAt: heartbeat }
          : { id: "cron", createdAt: new Date() }) as never);
      setupFetch({ getMe: getMeMock, getChat: getChatMock });

      const probes: { at: string; wallClockStale: boolean; ok: boolean }[] = [];
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        for (const event of events) {
          vi.setSystemTime(event.at);
          if (event.kind === "sweeper") {
            if (event.at < deadAfter) heartbeat = new Date(event.at);
            continue;
          }
          const { checks } = await notificationsHealth();
          probes.push({
            at: new Date(event.at).toISOString(),
            wallClockStale: checks.ownerDecisions.staleMin >= OWNER_DECISIONS_STALE_MINUTES,
            ok: checks.ownerDecisions.ok,
          });
          await recordSchedulerTick(event.at);
        }
      } finally {
        vi.useRealTimers();
      }
      return probes;
    }

    it("живой свипер: ни одного ложного «молчит», хотя по часам порог пересекался много раз", async () => {
      const probes = await replay();

      expect(probes.filter((p) => p.wallClockStale)).toHaveLength(6);
      expect(probes.filter((p) => !p.ok)).toEqual([]);
    });

    it("свипер умер 2026-11-05 — молчание ловится на второй пропущенной пачке", async () => {
      const probes = await replay("2026-11-05T00:00:00Z");

      const firstFailure = probes.find((p) => !p.ok);
      expect(firstFailure?.at).toBe("2026-11-05T12:20:17.000Z");
      expect(probes.filter((p) => p.at >= "2026-11-05T12:20:17.000Z").every((p) => !p.ok)).toBe(true);
    });
  });

  describe("shouldAlertOwnerDecisionsSilence — один CRITICAL на эпизод молчания", () => {
    const stale = {
      ok: false,
      lastHeartbeatAt: "2026-09-03T04:42:18.000Z",
      staleMin: 400,
      reason: "heartbeat старше 360 мин",
    };

    it("контур здоров → не алертит и Redis не трогает", async () => {
      await expect(
        shouldAlertOwnerDecisionsSilence({ ok: true, lastHeartbeatAt: null, staleMin: 1 })
      ).resolves.toBe(false);
      expect(redisSetMock).not.toHaveBeenCalled();
    });

    it("первый опрос эпизода: ключ по последнему heartbeat, SET NX EX на 6 часов → true", async () => {
      await expect(shouldAlertOwnerDecisionsSilence(stale)).resolves.toBe(true);
      expect(redisSetMock).toHaveBeenCalledWith(
        "owner-decisions:silence-alert:2026-09-03T04:42:18.000Z",
        "1",
        "EX",
        6 * 60 * 60,
        "NX"
      );
    });

    it("тот же эпизод в окне повтора (ключ занят) → false: site-watchdog раз в 5 мин не плодит алерты", async () => {
      redisSetMock.mockResolvedValue(null);
      await expect(shouldAlertOwnerDecisionsSilence(stale)).resolves.toBe(false);
    });

    it("heartbeat ни разу не был — ключ «never»", async () => {
      await shouldAlertOwnerDecisionsSilence({
        ok: false,
        lastHeartbeatAt: null,
        staleMin: 9999,
        reason: "heartbeat ни разу не зафиксирован",
      });
      expect(redisSetMock).toHaveBeenCalledWith(
        "owner-decisions:silence-alert:never",
        "1",
        "EX",
        expect.any(Number),
        "NX"
      );
    });

    it("Redis недоступен → fail-open: алертим", async () => {
      redisState.available = false;
      await expect(shouldAlertOwnerDecisionsSilence(stale)).resolves.toBe(true);
      expect(redisSetMock).not.toHaveBeenCalled();
    });

    it("Redis упал на SET → fail-open: алертим, ошибку не пробрасываем", async () => {
      redisSetMock.mockRejectedValue(new Error("ECONNRESET"));
      await expect(shouldAlertOwnerDecisionsSilence(stale)).resolves.toBe(true);
    });
  });
});
