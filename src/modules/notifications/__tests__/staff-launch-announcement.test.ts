import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: vi.fn(), logs: vi.fn(), logCreate: vi.fn(), logUpdate: vi.fn(),
  contacts: vi.fn(), snapshots: vi.fn(), telegram: vi.fn(), blocked: vi.fn(), proof: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: mocks.users },
    notificationLog: { findMany: mocks.logs, create: mocks.logCreate, update: mocks.logUpdate },
  },
}));
vi.mock("@/lib/telegram/client", () => ({ telegramApi: mocks.telegram }));
vi.mock("../audience", () => ({ loadStaffSnapshots: mocks.snapshots }));
vi.mock("@/modules/telegram-link/bot-contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/telegram-link/bot-contact")>()),
  getBotContacts: mocks.contacts,
  recordBotBlocked: mocks.blocked,
  recordDeliveryProof: mocks.proof,
}));

import type { StaffSnapshot } from "../audience-rules";
import {
  LAUNCH_ANNOUNCEMENT_UNTIL,
  buildLaunchAnnouncement,
  isAnnouncementWindow,
  launchClaimId,
  processStaffLaunchAnnouncement,
} from "../staff-launch-announcement";

const DAY = new Date("2026-11-09T11:00:00Z"); // 14:00 МСК
const started = { startedAt: new Date("2026-01-01"), startedBackfill: false, lastContactAt: null, lastDeliveryOkAt: null, blockedAt: null };
const snap = (id: string, role: StaffSnapshot["role"], grants: string[] = []): StaffSnapshot => ({
  id, role, merged: false, grants: new Set(grants), assignments: new Set(), prefs: new Map(), listModules: new Set(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
  mocks.logs.mockResolvedValue([]);
  mocks.logCreate.mockResolvedValue({});
  mocks.logUpdate.mockResolvedValue({});
  mocks.telegram.mockResolvedValue({ ok: true, result: { message_id: 9 } });
});

describe("окно кампании", () => {
  it("только днём по Москве и до конца кампании", () => {
    expect(isAnnouncementWindow(DAY)).toBe(true);
    expect(isAnnouncementWindow(new Date("2026-11-09T05:59:00Z"))).toBe(false); // 08:59 МСК
    expect(isAnnouncementWindow(new Date("2026-11-09T18:00:00Z"))).toBe(false); // 21:00 МСК
    expect(isAnnouncementWindow(LAUNCH_ANNOUNCEMENT_UNTIL)).toBe(false);
  });
});

describe("buildLaunchAnnouncement — текст по доступу", () => {
  it("админ видит только свои разделы", () => {
    const text = buildLaunchAnnouncement(["bookings", "system"]);
    expect(text).toContain("Брони");
    expect(text).toContain("«Профиль» → «Центр уведомлений»");
    expect(text).not.toContain("Звонки");
    expect(text).not.toContain("Отчётность");
    expect(text).not.toContain("Кафе");
  });

  it("суперадмин видит всё, включая звонки и отчётность", () => {
    const text = buildLaunchAnnouncement(["telephony", "reports", "bookings", "cafe", "rental", "payments", "avito", "system"]);
    for (const word of ["Звонки", "Отчётность", "Брони", "Кафе", "Аренда", "Платежи", "Авито"]) expect(text).toContain(word);
  });
});

describe("processStaffLaunchAnnouncement", () => {
  it("шлёт ADMIN и SUPERADMIN, которые запустили бота, текст — по их доступу", async () => {
    mocks.users.mockResolvedValue([{ id: "sa", telegramId: "1" }, { id: "ad", telegramId: "2" }, { id: "quiet", telegramId: "3" }]);
    mocks.contacts.mockResolvedValue(new Map([["1", started], ["2", started]])); // "quiet" never started the bot
    mocks.snapshots.mockResolvedValue([snap("sa", "SUPERADMIN"), snap("ad", "ADMIN")]);

    expect(await processStaffLaunchAnnouncement(DAY)).toEqual({ sent: 2, failed: 0, skipped: 0 });

    expect(mocks.users.mock.calls[0][0].where).toMatchObject({ role: { in: ["SUPERADMIN", "ADMIN"] }, mergedIntoUserId: null });
    const byChat = new Map(mocks.telegram.mock.calls.map(([, body]) => [body.chat_id, body.text as string]));
    expect(byChat.get("1")).toContain("Звонки");
    expect(byChat.get("2")).toContain("Брони"); // ADMIN owns gazebos/ps-park by role
    expect(byChat.get("2")).not.toContain("Звонки");
    expect(byChat.get("2")).not.toContain("Отчётность");
    expect(byChat.has("3")).toBe(false);
    expect(mocks.logCreate.mock.calls.map(([a]) => a.data.id)).toEqual([launchClaimId("sa"), launchClaimId("ad")]);
  });

  it("каждому один раз: уже отправленным и проигравшим гонку — не шлёт", async () => {
    mocks.users.mockResolvedValue([{ id: "sa", telegramId: "1" }, { id: "ad", telegramId: "2" }]);
    mocks.contacts.mockResolvedValue(new Map([["1", started], ["2", started]]));
    mocks.logs.mockResolvedValue([{ id: launchClaimId("sa") }]);
    mocks.snapshots.mockResolvedValue([snap("ad", "ADMIN")]);
    mocks.logCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    expect(await processStaffLaunchAnnouncement(DAY)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("понижен до MANAGER между запросами — пропуск", async () => {
    mocks.users.mockResolvedValue([{ id: "ad", telegramId: "2" }]);
    mocks.contacts.mockResolvedValue(new Map([["2", started]]));
    mocks.snapshots.mockResolvedValue([snap("ad", "MANAGER")]);

    expect(await processStaffLaunchAnnouncement(DAY)).toMatchObject({ sent: 0, skipped: 1 });
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("ночью и после кампании ничего не делает", async () => {
    expect(await processStaffLaunchAnnouncement(new Date("2026-11-09T20:00:00Z"))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await processStaffLaunchAnnouncement(new Date("2026-11-20T11:00:00Z"))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mocks.users).not.toHaveBeenCalled();
  });

  it("бот заблокирован — фиксируем, без повтора", async () => {
    mocks.users.mockResolvedValue([{ id: "ad", telegramId: "2" }]);
    mocks.contacts.mockResolvedValue(new Map([["2", started]]));
    mocks.snapshots.mockResolvedValue([snap("ad", "ADMIN")]);
    mocks.telegram.mockResolvedValue({ ok: false, description: "Forbidden: bot was blocked by the user", status: 403, retryable: false, transportError: false });

    expect(await processStaffLaunchAnnouncement(DAY)).toMatchObject({ failed: 1 });
    expect(mocks.blocked).toHaveBeenCalledWith("2");
  });
});
