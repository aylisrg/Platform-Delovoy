import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: vi.fn(),
  logs: vi.fn(),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  campaigns: vi.fn(),
  releases: vi.fn(),
  contacts: vi.fn(),
  telegram: vi.fn(),
  blocked: vi.fn(),
  proof: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: mocks.users },
    notificationLog: { findMany: mocks.logs, create: mocks.logCreate, update: mocks.logUpdate },
    broadcastCampaign: { findMany: mocks.campaigns },
    releaseAnnouncement: { findMany: mocks.releases },
  },
}));
vi.mock("@/lib/telegram/client", () => ({ telegramApi: mocks.telegram }));
vi.mock("@/modules/telegram-link/bot-contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/telegram-link/bot-contact")>()),
  getBotContacts: mocks.contacts,
  recordBotBlocked: mocks.blocked,
  recordDeliveryProof: mocks.proof,
}));

import {
  WEEKLY_DIGEST_EVENT,
  buildWeeklyDigest,
  digestClaimId,
  digestWeekKey,
  processWeeklyDigest,
  weekIndex,
} from "../weekly-digest";
import { CLIENT_TIPS, STAFF_APP_TIPS, sectionTips } from "../weekly-tips";

// Tuesday 2026-11-10 13:00 MSK
const TUESDAY_AFTER = new Date("2026-11-10T10:00:00Z");
const WEEK = "2026-11-09";
const started = { startedAt: new Date("2026-01-01"), startedBackfill: false, lastContactAt: null, lastDeliveryOkAt: null, blockedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
  mocks.logs.mockResolvedValue([]);
  mocks.logCreate.mockResolvedValue({});
  mocks.logUpdate.mockResolvedValue({});
  mocks.campaigns.mockResolvedValue([]);
  mocks.releases.mockResolvedValue([]);
  mocks.telegram.mockResolvedValue({ ok: true, result: { message_id: 7 } });
});

describe("digestWeekKey", () => {
  it("opens on Tuesday 12:00 MSK and keys the week by its Monday", () => {
    expect(digestWeekKey(new Date("2026-11-09T10:00:00Z"))).toBeNull(); // Monday
    expect(digestWeekKey(new Date("2026-11-10T08:59:59Z"))).toBeNull(); // Tue 11:59 MSK
    expect(digestWeekKey(new Date("2026-11-10T09:00:00Z"))).toBe(WEEK);
    expect(digestWeekKey(new Date("2026-11-15T20:59:59Z"))).toBe(WEEK); // Sun 23:59 MSK
    expect(digestWeekKey(new Date("2026-11-15T21:00:00Z"))).toBeNull(); // next Monday
  });
});

describe("buildWeeklyDigest — уровни доступа", () => {
  const news = { publicNews: ["Новое меню кафе"], releases: ["Перенос броней в панели"] };

  it("гость получает только публичную подсказку и публичные новости", () => {
    const text = buildWeeklyDigest({ role: "USER", sections: [] }, news, 0);
    expect(text).toContain(CLIENT_TIPS[0].title);
    expect(text).toContain("Новое меню кафе");
    expect(text).not.toContain("Для работы");
    expect(text).not.toContain("Обновления платформы");
    expect(text).not.toContain("Перенос броней в панели");
    expect(text).not.toMatch(/\/admin/);
  });

  it("сотрудник получает подсказку только по своему разделу", () => {
    const own = sectionTips(["cafe"]);
    const text = buildWeeklyDigest({ role: "MANAGER", sections: ["cafe"] }, news, 0);
    expect(text).toContain("Для работы · Кафе");
    expect(own.some((tip) => text.includes(tip.title))).toBe(true);
    const foreign = sectionTips(["rental", "users", "monitoring"]).filter((t) => !own.some((o) => o.title === t.title));
    expect(foreign.some((tip) => text.includes(tip.title))).toBe(false);
    expect(text).toContain("Перенос броней в панели");
  });

  it("сотрудник без разделов получает подсказку про Mini App, не про чужой раздел", () => {
    for (let i = 0; i < 6; i++) {
      const text = buildWeeklyDigest({ role: "MANAGER", sections: [] }, news, i);
      expect(text).not.toContain("Для работы ·");
      expect(STAFF_APP_TIPS.some((tip) => text.includes(tip.title))).toBe(true);
    }
  });

  it("явное «выкл» релизов скрывает их и в дайджесте", () => {
    const text = buildWeeklyDigest({ role: "SUPERADMIN", sections: [], releasesOff: true }, news, 0);
    expect(text).not.toContain("Обновления платформы");
    expect(text).toContain("Новое меню кафе");
  });

  it("экранирует HTML в новостях", () => {
    const text = buildWeeklyDigest({ role: "USER", sections: [] }, { publicNews: ["<b>x</b> & y"], releases: [] }, 1);
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("подсказки ротируются по неделям", () => {
    const a = buildWeeklyDigest({ role: "USER", sections: [] }, { publicNews: [], releases: [] }, weekIndex("2026-11-09"));
    const b = buildWeeklyDigest({ role: "USER", sections: [] }, { publicNews: [], releases: [] }, weekIndex("2026-11-16"));
    expect(a).not.toBe(b);
  });
});

describe("processWeeklyDigest", () => {
  it("вне окна и без токена ничего не делает", async () => {
    expect((await processWeeklyDigest(new Date("2026-11-09T10:00:00Z"))).sent).toBe(0);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await processWeeklyDigest(TUESDAY_AFTER)).sent).toBe(0);
    expect(mocks.users).not.toHaveBeenCalled();
  });

  it("шлёт тем, кто запустил бота; отписку исключает запросом; не шлёт повторно", async () => {
    mocks.users.mockResolvedValue([
      { id: "u1", role: "USER", telegramId: "101", adminPermissions: [], notificationEventPrefs: [] },
      { id: "u2", role: "USER", telegramId: "102", adminPermissions: [], notificationEventPrefs: [] }, // never started the bot
      { id: "u3", role: "USER", telegramId: "103", adminPermissions: [], notificationEventPrefs: [] }, // already got this week
    ]);
    mocks.contacts.mockResolvedValue(new Map([["101", started], ["103", started]]));
    mocks.logs.mockResolvedValue([{ id: digestClaimId("u3", WEEK) }]);

    const result = await processWeeklyDigest(TUESDAY_AFTER);

    expect(result).toMatchObject({ weekKey: WEEK, sent: 1, failed: 0 });
    expect(mocks.users.mock.calls[0][0].where).toMatchObject({
      telegramId: { not: null },
      mergedIntoUserId: null,
      notificationEventPrefs: { none: { eventType: WEEKLY_DIGEST_EVENT, enabled: false } },
    });
    expect(mocks.telegram).toHaveBeenCalledTimes(1);
    expect(mocks.telegram.mock.calls[0][1]).toMatchObject({ chat_id: "101", parse_mode: "HTML" });
    expect(mocks.logCreate.mock.calls[0][0].data).toMatchObject({ id: digestClaimId("u1", WEEK), status: "PENDING" });
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
    expect(mocks.proof).toHaveBeenCalledWith("101");
  });

  it("гонка параллельных прогонов: занятый claim — пропуск без отправки", async () => {
    mocks.users.mockResolvedValue([{ id: "u1", role: "USER", telegramId: "101", adminPermissions: [], notificationEventPrefs: [] }]);
    mocks.contacts.mockResolvedValue(new Map([["101", started]]));
    mocks.logCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    const result = await processWeeklyDigest(TUESDAY_AFTER);

    expect(result.skipped).toBe(1);
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("блокировка бота фиксируется, письмо не повторяется", async () => {
    mocks.users.mockResolvedValue([{ id: "u1", role: "ADMIN", telegramId: "101", adminPermissions: [{ section: "cafe" }], notificationEventPrefs: [] }]);
    mocks.contacts.mockResolvedValue(new Map([["101", started]]));
    mocks.telegram.mockResolvedValue({ ok: false, description: "Forbidden: bot was blocked by the user", status: 403, retryable: false, transportError: false });

    const result = await processWeeklyDigest(TUESDAY_AFTER);

    expect(result.failed).toBe(1);
    expect(mocks.blocked).toHaveBeenCalledWith("101");
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED", error: "BOT_BLOCKED" } }));
  });

  it("релизы — только завершённые анонсы последней недели", async () => {
    mocks.users.mockResolvedValue([{ id: "a", role: "SUPERADMIN", telegramId: "101", adminPermissions: [], notificationEventPrefs: [] }]);
    mocks.contacts.mockResolvedValue(new Map([["101", started]]));
    mocks.releases.mockResolvedValue([{ releaseNotes: "## Перенос броней\n- детали" }]);

    await processWeeklyDigest(TUESDAY_AFTER);

    expect(mocks.releases.mock.calls[0][0].where.source).toEqual({ in: ["deploy", "manual", "deploy:complete", "manual:complete"] });
    expect(mocks.telegram.mock.calls[0][1].text).toContain("• Перенос броней");
  });
});
