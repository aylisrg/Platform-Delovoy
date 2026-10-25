import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, makeUser, type MemoryDb, type Row, type Tables } from "./helpers/memory-db";

/**
 * Account merge engine — ADR 2026-10-25-team-access-notifications §Q6/§5.4,
 * PRD US-E2 (QA control set «Объединение (E2)»). The DB is an in-memory
 * stand-in that enforces the schema's unique constraints and rolls back on
 * errors; true row-lock concurrency was additionally verified on Postgres.
 */

const h = vi.hoisted(() => ({
  db: null as null | { client: Record<string, unknown> },
  publish: vi.fn(async () => undefined),
  getBotContacts: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, { get: (_t, prop: string) => h.db!.client[prop] }),
}));
vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn() },
  redisAvailable: false,
}));
vi.mock("@/lib/session-revocation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session-revocation")>()),
  publishAuthState: h.publish,
}));
vi.mock("@/modules/telegram-link/bot-contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/telegram-link/bot-contact")>()),
  getBotContacts: h.getBotContacts,
  getBotTrackingSince: vi.fn(async () => null),
}));

import {
  mergeAccounts,
  mergeClients,
  previewAccountMerge,
  searchMergeCandidates,
  suggestPrimary,
} from "../merge";

let db: MemoryDb;
const SEEDED_TG = "694696"; // DEFAULT_SUPERADMIN_TELEGRAM_ID

function install(tables: Tables): Tables {
  db = createMemoryDb(tables);
  h.db = db;
  return tables;
}

const modules = (): Row[] => [
  { id: "mod-cafe", slug: "cafe", name: "Кафе" },
  { id: "mod-gazebos", slug: "gazebos", name: "Барбекю Парк" },
  { id: "mod-ps", slug: "ps-park", name: "Плей Парк" },
];

const actor = () => makeUser({ id: "sa-actor", role: "SUPERADMIN", name: "Владелец" });

function user(tables: Tables, id: string): Row {
  const row = tables.user.find((u) => u.id === id);
  if (!row) throw new Error(`no user ${id}`);
  return row;
}

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  await expect(promise).rejects.toMatchObject(status ? { code, status } : { code });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SUPERADMIN_TELEGRAM_ID;
});

describe("suggestPrimary (AC-E2.2)", () => {
  const base = { email: null, createdAt: "2026-01-01T00:00:00Z" };
  it("AC-E2.2: higher role wins", () => {
    expect(suggestPrimary({ ...base, id: "a", role: "USER" }, { ...base, id: "b", role: "MANAGER" })).toBe("b");
    expect(suggestPrimary({ ...base, id: "a", role: "SUPERADMIN" }, { ...base, id: "b", role: "ADMIN" })).toBe("a");
  });
  it("AC-E2.2: equal roles — the one with an email", () => {
    expect(suggestPrimary({ ...base, id: "a", role: "USER" }, { ...base, id: "b", role: "USER", email: "b@x.ru" })).toBe("b");
  });
  it("AC-E2.2: otherwise the older account, then the smaller id", () => {
    expect(
      suggestPrimary(
        { id: "a", role: "USER", email: null, createdAt: new Date("2026-03-01") },
        { id: "b", role: "USER", email: null, createdAt: new Date("2026-02-01") },
      ),
    ).toBe("b");
    expect(suggestPrimary({ ...base, id: "z", role: "USER" }, { ...base, id: "y", role: "USER" })).toBe("y");
  });
});

describe("mergeAccounts — QA control set «Объединение (E2)»", () => {
  function controlSet(): Tables {
    return install({
      module: modules(),
      user: [
        actor(),
        makeUser({ id: "p-mgr", role: "MANAGER", name: "Пётр", email: "petr@mail.ru", emailNormalized: "petr@mail.ru" }),
        makeUser({ id: "s-bot", role: "USER", name: "Петя (бот)", telegramId: "5550001", source: "telegram_bot" }),
      ],
      adminPermission: [
        { id: "ap1", userId: "p-mgr", section: "cafe" },
        { id: "ap2", userId: "p-mgr", section: "gazebos" },
      ],
      moduleAssignment: [{ id: "ma1", userId: "p-mgr", moduleId: "mod-cafe" }],
      booking: [
        { id: "b1", userId: "s-bot" },
        { id: "b2", userId: "s-bot" },
      ],
    });
  }

  it("AC-E2.4а / AC-E2.6: MANAGER keeps role, sections and module; Telegram and 2 bookings move; secondary hidden", async () => {
    const tables = controlSet();

    const result = await mergeAccounts({ primaryId: "p-mgr", secondaryId: "s-bot", actorId: "sa-actor", mode: "admin" });

    expect(result).toMatchObject({ primaryId: "p-mgr", tombstonedUserId: "s-bot", resultingRole: "MANAGER" });
    expect(result.moved.bookings).toBe(2);
    const primary = user(tables, "p-mgr");
    expect(primary).toMatchObject({ role: "MANAGER", telegramId: "5550001", email: "petr@mail.ru" });
    expect(tables.adminPermission.filter((p) => p.userId === "p-mgr").map((p) => p.section)).toEqual(["cafe", "gazebos"]);
    expect(tables.moduleAssignment.filter((a) => a.userId === "p-mgr")).toHaveLength(1);
    expect(tables.booking.every((b) => b.userId === "p-mgr")).toBe(true);

    const secondary = user(tables, "s-bot");
    expect(secondary).toMatchObject({ mergedIntoUserId: "p-mgr", role: "USER", telegramId: null, sessionVersion: 1 });
    expect(secondary.mergedAt).toBeInstanceOf(Date);
    expect(tables.user).toHaveLength(3); // tombstone, never deleted
  });

  it("AC-E2.9: publishes the secondary's auth state after commit; the primary's session is untouched", async () => {
    const tables = controlSet();
    await mergeAccounts({ primaryId: "p-mgr", secondaryId: "s-bot", actorId: "sa-actor", mode: "admin" });
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledWith("s-bot");
    expect(user(tables, "p-mgr").sessionVersion).toBe(0);
  });

  it("runs in one transaction with a 30 s timeout", async () => {
    controlSet();
    await mergeAccounts({ primaryId: "p-mgr", secondaryId: "s-bot", actorId: "sa-actor", mode: "admin" });
    expect(db.transactionCalls).toEqual([{ timeout: 30_000, maxWait: 10_000 }]);
  });

  it("AC-E2.8: one auth.merge.manual row — actor, both accounts, resulting role, counters", async () => {
    const tables = controlSet();
    await mergeAccounts({ primaryId: "p-mgr", secondaryId: "s-bot", actorId: "sa-actor", mode: "admin" });

    const rows = tables.auditLog.filter((a) => a.action === "auth.merge.manual");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "sa-actor", entity: "User", entityId: "p-mgr" });
    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ mode: "admin", primaryId: "p-mgr", secondaryId: "s-bot", resultingRole: "MANAGER" });
    expect((meta.fkMoved as Record<string, number>).bookings).toBe(2);
    expect(meta.transferredFields).toEqual(["telegram"]);
    expect(JSON.stringify(meta)).not.toContain("5550001");
  });
});

describe("mergeAccounts — rights and roles (AC-E2.4а/б)", () => {
  it("AC-E2.4а: the secondary's AdminPermission / ModuleAssignment are deleted, not moved; it becomes USER", async () => {
    const tables = install({
      module: modules(),
      user: [
        actor(),
        makeUser({ id: "p-adm", role: "ADMIN", email: "a@x.ru" }),
        makeUser({ id: "s-mgr", role: "MANAGER", email: "m@x.ru" }),
      ],
      adminPermission: [
        { id: "ap1", userId: "p-adm", section: "analytics" },
        { id: "ap2", userId: "s-mgr", section: "cafe" },
        { id: "ap3", userId: "s-mgr", section: "tasks" },
      ],
      moduleAssignment: [{ id: "ma1", userId: "s-mgr", moduleId: "mod-cafe" }],
    });

    const result = await mergeAccounts({ primaryId: "p-adm", secondaryId: "s-mgr", actorId: "sa-actor", mode: "admin" });

    expect(result.resultingRole).toBe("ADMIN");
    expect(result.moved.adminPermissions).toBe(0);
    expect(result.moved.moduleAssignments).toBe(0);
    expect(tables.adminPermission.map((p) => [p.userId, p.section])).toEqual([["p-adm", "analytics"]]);
    expect(tables.moduleAssignment).toHaveLength(0);
    expect(user(tables, "s-mgr").role).toBe("USER");
    const meta = tables.auditLog.find((a) => a.action === "auth.merge.manual")!.metadata as Record<string, unknown>;
    expect(meta.droppedSecondaryRights).toEqual({ role: "MANAGER", sections: ["cafe", "tasks"], modules: ["cafe"] });
  });

  it("AC-E2.4б: the only active SUPERADMIN can't be merged into a non-SUPERADMIN (system / merged don't count)", async () => {
    const tables = install({
      user: [
        makeUser({ id: "system", role: "SUPERADMIN" }),
        makeUser({ id: "old-sa", role: "SUPERADMIN", mergedIntoUserId: "sa-only" }),
        makeUser({ id: "sa-only", role: "SUPERADMIN", email: "sa@x.ru" }),
        makeUser({ id: "p-mgr", role: "MANAGER" }),
      ],
      booking: [{ id: "b1", userId: "sa-only" }],
    });

    await expectCode(
      mergeAccounts({ primaryId: "p-mgr", secondaryId: "sa-only", actorId: "someone", mode: "admin" }),
      "LAST_SUPERADMIN",
      409,
    );
    expect(user(tables, "sa-only")).toMatchObject({ mergedIntoUserId: null, role: "SUPERADMIN" });
    expect(tables.booking[0].userId).toBe("sa-only");
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("AC-E2.4б: with another active SUPERADMIN the merge goes through and nobody is promoted", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "sa-2", role: "SUPERADMIN" }), makeUser({ id: "p-mgr", role: "MANAGER" })],
    });
    const result = await mergeAccounts({ primaryId: "p-mgr", secondaryId: "sa-2", actorId: "sa-actor", mode: "admin" });
    expect(result.resultingRole).toBe("MANAGER");
    expect(user(tables, "p-mgr").role).toBe("MANAGER");
    expect(user(tables, "sa-2").role).toBe("USER");
  });

  it("AC-E2.4д: the seeded SUPERADMIN can't be the secondary", async () => {
    install({
      user: [actor(), makeUser({ id: "seed", role: "SUPERADMIN", telegramId: SEEDED_TG }), makeUser({ id: "p" })],
    });
    await expectCode(
      mergeAccounts({ primaryId: "p", secondaryId: "seed", actorId: "sa-actor", mode: "admin" }),
      "SECONDARY_SEEDED_SUPERADMIN",
      409,
    );
  });

  it("AC-E2.4д: …but it may be the primary", async () => {
    const tables = install({
      user: [makeUser({ id: "seed", role: "SUPERADMIN", telegramId: SEEDED_TG }), makeUser({ id: "dup", email: "o@x.ru" })],
    });
    await mergeAccounts({ primaryId: "seed", secondaryId: "dup", actorId: "seed", mode: "admin" });
    expect(user(tables, "seed")).toMatchObject({ telegramId: SEEDED_TG, email: "o@x.ru", role: "SUPERADMIN" });
  });

  it("AC-E2.2: the account you are signed in with can't be the secondary (no transaction started)", async () => {
    install({ user: [actor(), makeUser({ id: "p" })] });
    await expectCode(
      mergeAccounts({ primaryId: "p", secondaryId: "sa-actor", actorId: "sa-actor", mode: "admin" }),
      "SECONDARY_IS_ACTOR",
      409,
    );
    expect(db.transactionCalls).toHaveLength(0);
  });
});

describe("mergeAccounts — guards and edge cases (AC-E2.7)", () => {
  it("AC-E2.7: already merged primary or secondary → ALREADY_MERGED", async () => {
    install({
      user: [actor(), makeUser({ id: "a" }), makeUser({ id: "gone", mergedIntoUserId: "a" }), makeUser({ id: "b" })],
    });
    await expectCode(mergeAccounts({ primaryId: "a", secondaryId: "gone", actorId: "sa-actor", mode: "admin" }), "ALREADY_MERGED", 409);
    await expectCode(mergeAccounts({ primaryId: "gone", secondaryId: "b", actorId: "sa-actor", mode: "admin" }), "ALREADY_MERGED", 409);
  });

  it("AC-E2.7: a repeated (parallel) merge of the same pair sees the tombstone → ALREADY_MERGED", async () => {
    install({ user: [actor(), makeUser({ id: "a" }), makeUser({ id: "b", phone: "+79990000001" })] });
    await mergeAccounts({ primaryId: "a", secondaryId: "b", actorId: "sa-actor", mode: "admin" });
    await expectCode(mergeAccounts({ primaryId: "a", secondaryId: "b", actorId: "sa-actor", mode: "admin" }), "ALREADY_MERGED");
  });

  it("SAME_ACCOUNT and USER_NOT_FOUND", async () => {
    install({ user: [actor(), makeUser({ id: "a" })] });
    await expectCode(mergeAccounts({ primaryId: "a", secondaryId: "a", actorId: "sa-actor", mode: "admin" }), "SAME_ACCOUNT", 422);
    await expectCode(mergeAccounts({ primaryId: "a", secondaryId: "nope", actorId: "sa-actor", mode: "admin" }), "USER_NOT_FOUND", 404);
  });

  it("both ACTIVE subscriptions → ACTIVE_SUBSCRIPTION_CONFLICT; one ACTIVE + one finished moves", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "a" }), makeUser({ id: "b" }), makeUser({ id: "c" })],
      subscription: [
        { id: "sa", userId: "a", status: "ACTIVE" },
        { id: "sb", userId: "b", status: "ACTIVE" },
        { id: "sc", userId: "c", status: "EXPIRED" },
      ],
    });
    await expectCode(mergeAccounts({ primaryId: "a", secondaryId: "b", actorId: "sa-actor", mode: "admin" }), "ACTIVE_SUBSCRIPTION_CONFLICT", 409);
    const result = await mergeAccounts({ primaryId: "a", secondaryId: "c", actorId: "sa-actor", mode: "admin" });
    expect(result.moved.subscriptions).toBe(1);
    expect(tables.subscription.find((s) => s.id === "sc")!.userId).toBe("a");
  });

  it("AC-E2.7: a failure half-way rolls every change back (no partial merge)", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "a" }), makeUser({ id: "b", telegramId: "777" })],
      booking: [{ id: "b1", userId: "b" }],
      moduleNotificationRecipient: [{ moduleSlug: "cafe", userId: "b" }],
    });
    (db.client.auditLog as { create: () => Promise<never> }).create = async () => {
      throw new Error("db down");
    };

    await expect(mergeAccounts({ primaryId: "a", secondaryId: "b", actorId: "sa-actor", mode: "admin" })).rejects.toThrow("db down");
    expect(tables.booking[0].userId).toBe("b");
    expect(tables.moduleNotificationRecipient[0].userId).toBe("b");
    expect(user(tables, "b")).toMatchObject({ telegramId: "777", mergedIntoUserId: null, sessionVersion: 0 });
    expect(user(tables, "a").telegramId).toBeNull();
    expect(h.publish).not.toHaveBeenCalled();
  });
});

describe("mergeAccounts — contacts (AC-E2.4г)", () => {
  it("AC-E2.4г: frees the secondary's unique fields BEFORE filling the primary (no P2002 on email/phone)", async () => {
    const tables = install({
      user: [
        actor(),
        makeUser({ id: "p-bot", telegramId: "4242" }),
        makeUser({
          id: "s-mail",
          email: "Ivan@Mail.ru",
          emailNormalized: "ivan@mail.ru",
          emailVerified: new Date("2026-02-02"),
          passwordHash: "bcrypt-hash",
          phone: "+79161234567",
          phoneNormalized: "+79161234567",
          vkId: "vk-1",
          image: "https://img/1.png",
        }),
      ],
    });

    await mergeAccounts({ primaryId: "p-bot", secondaryId: "s-mail", actorId: "sa-actor", mode: "admin" });

    expect(user(tables, "p-bot")).toMatchObject({
      telegramId: "4242",
      email: "Ivan@Mail.ru",
      emailNormalized: "ivan@mail.ru",
      phone: "+79161234567",
      phoneNormalized: "+79161234567",
      vkId: "vk-1",
      image: "https://img/1.png",
      passwordHash: "bcrypt-hash",
    });
    expect(user(tables, "p-bot").emailVerified).toEqual(new Date("2026-02-02"));
    expect(user(tables, "s-mail")).toMatchObject({ email: null, emailNormalized: null, phone: null, phoneNormalized: null, vkId: null });
  });

  it("AC-E2.4г / AC-E2.7: different emails and phones — the primary's stay, the secondary's land in the journal", async () => {
    const tables = install({
      user: [
        actor(),
        makeUser({ id: "p", email: "p@x.ru", phone: "+79990000001", name: "Пётр" }),
        makeUser({ id: "s", email: "s@x.ru", phone: "+79990000002", name: "Петя" }),
      ],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(user(tables, "p")).toMatchObject({ email: "p@x.ru", phone: "+79990000001", name: "Пётр" });
    const meta = tables.auditLog.find((a) => a.action === "auth.merge.manual")!.metadata as Record<string, unknown>;
    expect(meta.conflicts).toEqual([
      { field: "email", primaryValue: "p@x.ru", secondaryValue: "s@x.ru" },
      { field: "phone", primaryValue: "+79990000001", secondaryValue: "+79990000002" },
      { field: "name", primaryValue: "Пётр", secondaryValue: "Петя" },
    ]);
  });

  it("AC-E2.4г: different Telegrams need explicit confirmation; then the primary's Telegram stays", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p", telegramId: "11112222" }), makeUser({ id: "s", telegramId: "33334444" })],
    });
    await expectCode(
      mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" }),
      "TELEGRAM_CONFLICT_UNCONFIRMED",
      409,
    );
    expect(user(tables, "s").mergedIntoUserId).toBeNull();

    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin", confirmTelegramConflict: true });
    expect(user(tables, "p").telegramId).toBe("11112222");
    expect(user(tables, "s").telegramId).toBeNull();
    const meta = tables.auditLog.find((a) => a.action === "auth.merge.manual")!.metadata as Record<string, unknown>;
    expect(meta.conflicts).toEqual([{ field: "telegram", primaryValue: "****2222", secondaryValue: "****4444" }]);
    expect(meta.telegramConflictConfirmed).toBe(true);
  });
});

describe("mergeAccounts — what moves (ADR §Q6)", () => {
  it("AC-E2.6: recipient-list rows of the secondary point at the primary, without duplicates", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p", role: "ADMIN" }), makeUser({ id: "s" })],
      moduleNotificationRecipient: [
        { moduleSlug: "cafe", userId: "p", createdByUserId: "sa-actor" },
        { moduleSlug: "cafe", userId: "s", createdByUserId: "sa-actor" },
        { moduleSlug: "gazebos", userId: "s", createdByUserId: "x" },
      ],
    });
    const result = await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(tables.moduleNotificationRecipient.map((r) => [r.moduleSlug, r.userId]).sort()).toEqual([
      ["cafe", "p"],
      ["gazebos", "p"],
    ]);
    expect(result.moved.recipientLists).toBe(1);
  });

  it("AC-E2.6: lists the primary isn't admitted to are dropped, not moved (they'd silence the group chat)", async () => {
    const tables = install({
      module: modules(),
      user: [actor(), makeUser({ id: "p", role: "MANAGER" }), makeUser({ id: "s", role: "MANAGER" })],
      moduleAssignment: [
        { id: "ma1", userId: "p", moduleId: "mod-cafe" },
        { id: "ma2", userId: "s", moduleId: "mod-gazebos" },
      ],
      moduleNotificationRecipient: [
        { moduleSlug: "cafe", userId: "s", createdByUserId: "sa-actor" },
        { moduleSlug: "gazebos", userId: "s", createdByUserId: "sa-actor" },
      ],
    });
    const preview = await previewAccountMerge({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(preview.access.recipientLists).toEqual(["Кафе"]);
    expect(preview.notTransferred).toContainEqual({
      key: "recipientLists",
      label: "Списки получателей, куда основной аккаунт не допущен",
      items: ["Барбекю Парк"],
    });

    const result = await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(tables.moduleNotificationRecipient.map((r) => [r.moduleSlug, r.userId])).toEqual([["cafe", "p"]]);
    expect(result.moved.recipientLists).toBe(1);
  });

  it("the technical `system` user is never a merge participant", async () => {
    install({ user: [actor(), makeUser({ id: "system", role: "SUPERADMIN" }), makeUser({ id: "s" })] });
    await expect(
      mergeAccounts({ primaryId: "system", secondaryId: "s", actorId: "sa-actor", mode: "admin" }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(
      previewAccountMerge({ primaryId: "s", secondaryId: "system", actorId: "sa-actor", mode: "admin" }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("AC-E2.4в: per eventType the primary's subscription wins, the rest moves", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p" }), makeUser({ id: "s" })],
      notificationEventPreference: [
        { id: "n1", userId: "p", eventType: "booking.created", enabled: false },
        { id: "n2", userId: "s", eventType: "booking.created", enabled: true },
        { id: "n3", userId: "s", eventType: "order.placed", enabled: true },
      ],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(tables.notificationEventPreference.map((n) => [n.userId, n.eventType, n.enabled])).toEqual([
      ["p", "booking.created", false],
      ["p", "order.placed", true],
    ]);
  });

  it("re-points OutgoingNotification of duplicate channels to the primary's channel and keeps the push subscription attached", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p" }), makeUser({ id: "s" })],
      userNotificationChannel: [
        { id: "p-push", userId: "p", kind: "PUSH", address: "https://push/1" },
        { id: "s-push", userId: "s", kind: "PUSH", address: "https://push/1" },
        { id: "s-tg", userId: "s", kind: "TELEGRAM", address: "999" },
      ],
      webPushSubscription: [{ id: "wps", userId: "s", endpoint: "https://push/1", userNotificationChannelId: "s-push" }],
      outgoingNotification: [
        { id: "o1", userId: "s", channelId: "s-push" },
        { id: "o2", userId: "s", channelId: "s-tg" },
      ],
    });
    const result = await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(tables.outgoingNotification).toEqual([
      expect.objectContaining({ id: "o1", channelId: "p-push", userId: "p" }),
      expect.objectContaining({ id: "o2", channelId: "s-tg", userId: "p" }),
    ]);
    expect(tables.userNotificationChannel.map((c) => [c.id, c.userId])).toEqual([
      ["p-push", "p"],
      ["s-tg", "p"],
    ]);
    expect(tables.webPushSubscription[0]).toMatchObject({ userId: "p", userNotificationChannelId: "p-push" });
    expect(result.moved).toMatchObject({ outgoingRepointed: 1, outgoingNotifications: 2, notificationChannels: 1, webPushSubscriptions: 1 });
  });

  it("a staff primary gets a Telegram delivery channel for the Telegram that moved in (no «Нет рабочего канала» after merge)", async () => {
    const tables = install({
      user: [
        actor(),
        makeUser({ id: "p", role: "ADMIN", email: "lp@mail.ru" }),
        makeUser({ id: "s", telegramId: "7777" }),
      ],
    });
    const preview = await previewAccountMerge({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(preview.channels.moved).toEqual(["Telegram"]);

    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(user(tables, "p").telegramId).toBe("7777");
    expect(tables.userNotificationChannel).toEqual([
      expect.objectContaining({ userId: "p", kind: "TELEGRAM", address: "7777", isActive: true }),
    ]);
    const audit = tables.auditLog.find((a) => a.action === "auth.merge.manual")!.metadata as Record<string, unknown>;
    expect(audit.telegramChannelEnsured).toBe(true);
  });

  it("…but not for a client primary, and never a duplicate when the channel already moved", async () => {
    const clients = install({
      user: [actor(), makeUser({ id: "p", email: "c@mail.ru" }), makeUser({ id: "s", telegramId: "7777" })],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(clients.userNotificationChannel ?? []).toEqual([]);

    const staff = install({
      user: [actor(), makeUser({ id: "p", role: "MANAGER" }), makeUser({ id: "s", telegramId: "7777" })],
      userNotificationChannel: [{ id: "s-tg", userId: "s", kind: "TELEGRAM", address: "7777" }],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(staff.userNotificationChannel.map((c) => [c.id, c.userId, c.address])).toEqual([["s-tg", "p", "7777"]]);

    // A moved channel the person switched off stays off.
    const off = install({
      user: [actor(), makeUser({ id: "p", role: "MANAGER" }), makeUser({ id: "s", telegramId: "7777" })],
      userNotificationChannel: [{ id: "s-tg", userId: "s", kind: "TELEGRAM", address: "7777", isActive: false }],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(off.userNotificationChannel).toEqual([expect.objectContaining({ id: "s-tg", userId: "p", isActive: false })]);
  });

  it("moves chats (participants dedup by chat, receipts dedup by message), in-app feed, skips, links", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p" }), makeUser({ id: "s" })],
      chat: [
        { id: "shared", createdByUserId: "p" },
        { id: "own", createdByUserId: "s" },
      ],
      chatParticipant: [
        { id: "cp1", chatId: "shared", userId: "p" },
        { id: "cp2", chatId: "shared", userId: "s" },
        { id: "cp3", chatId: "own", userId: "s" },
      ],
      chatMessage: [{ id: "m1", chatId: "shared", senderUserId: "s" }, { id: "m2", chatId: "own", senderUserId: "s" }],
      chatMessageReceipt: [
        { messageId: "m1", userId: "p" },
        { messageId: "m1", userId: "s" },
        { messageId: "m2", userId: "s" },
      ],
      inAppNotification: [{ id: "ia1", userId: "s" }],
      notificationDeliverySkip: [{ id: "sk1", userId: "s" }],
      notificationLink: [{ id: "l1", userId: "s", outgoingId: "o" }],
    });
    const result = await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });

    expect(tables.chatParticipant.map((c) => [c.chatId, c.userId]).sort()).toEqual([
      ["own", "p"],
      ["shared", "p"],
    ]);
    expect(tables.chatMessageReceipt.map((r) => [r.messageId, r.userId]).sort()).toEqual([
      ["m1", "p"],
      ["m2", "p"],
    ]);
    expect(tables.chatMessage.every((m) => m.senderUserId === "p")).toBe(true);
    expect(tables.chat.every((c) => c.createdByUserId === "p")).toBe(true);
    expect(tables.inAppNotification[0].userId).toBe("p");
    expect(tables.notificationDeliverySkip[0].userId).toBe("p");
    expect(tables.notificationLink[0].userId).toBe("p");
    expect(result.moved).toMatchObject({
      chatParticipants: 1,
      chatReceipts: 1,
      chatMessages: 2,
      chatsCreated: 1,
      inAppNotifications: 1,
      deliverySkips: 1,
      notificationLinks: 1,
    });
  });

  it("AC-E2.9: the secondary's DB sessions are revoked, not handed to the primary", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p" }), makeUser({ id: "s" })],
      session: [{ id: "ss", userId: "s", sessionToken: "t" }, { id: "ps", userId: "p", sessionToken: "u" }],
    });
    const result = await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    expect(tables.session.map((s) => s.id)).toEqual(["ps"]);
    expect(result.moved.sessions).toBe(1);
  });

  it("merge queue: the pair (either order) → RESOLVED_MERGED, other open ones with the secondary → DISMISSED", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p" }), makeUser({ id: "s" }), makeUser({ id: "x" }), makeUser({ id: "y" })],
      mergeCandidate: [
        { id: "pair", primaryUserId: "s", candidateUserId: "p", status: "PENDING" },
        { id: "other", primaryUserId: "s", candidateUserId: "x", status: "PENDING" },
        { id: "closed", primaryUserId: "s", candidateUserId: "y", status: "RESOLVED_KEPT_SEPARATE" },
        { id: "unrelated", primaryUserId: "x", candidateUserId: "y", status: "PENDING" },
      ],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin" });
    const status = Object.fromEntries(tables.mergeCandidate.map((m) => [m.id, m.status]));
    expect(status).toEqual({ pair: "RESOLVED_MERGED", other: "DISMISSED", closed: "RESOLVED_KEPT_SEPARATE", unrelated: "PENDING" });
    expect(tables.mergeCandidate.find((m) => m.id === "pair")).toMatchObject({ resolvedByUserId: "sa-actor" });
  });

  it("AC-E1.3 / AC-E2.6: the surviving Telegram gets the earlier first start; its own block state stays", async () => {
    const blockedAt = new Date("2026-06-01");
    const tables = install({
      user: [actor(), makeUser({ id: "p", telegramId: "1001" }), makeUser({ id: "s", telegramId: "2002" })],
      telegramBotContact: [
        { telegramId: "1001", startedAt: new Date("2026-05-01"), blockedAt, startedBackfill: false },
        { telegramId: "2002", startedAt: new Date("2026-02-01"), blockedAt: null, startedBackfill: false },
      ],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin", confirmTelegramConflict: true });
    expect(tables.telegramBotContact.find((c) => c.telegramId === "1001")).toMatchObject({
      startedAt: new Date("2026-02-01"),
      blockedAt,
    });
  });

  it("never stamps «Бот запущен» on a surviving Telegram that never reached the bot", async () => {
    const tables = install({
      user: [actor(), makeUser({ id: "p", telegramId: "1001" }), makeUser({ id: "s", telegramId: "2002" })],
      telegramBotContact: [{ telegramId: "2002", startedAt: new Date("2026-02-01"), startedBackfill: false }],
    });
    await mergeAccounts({ primaryId: "p", secondaryId: "s", actorId: "sa-actor", mode: "admin", confirmTelegramConflict: true });
    expect(tables.telegramBotContact.find((c) => c.telegramId === "1001")).toBeUndefined();
  });
});

describe("mergeAccounts — modes", () => {
  it("self_link: audited as auth.merge.self_link by the primary itself", async () => {
    const tables = install({ user: [makeUser({ id: "web", role: "ADMIN", email: "w@x.ru" }), makeUser({ id: "tg", telegramId: "4343" })] });
    await mergeAccounts({ primaryId: "web", secondaryId: "tg", actorId: "web", mode: "self_link" });
    const row = tables.auditLog.find((a) => a.action === "auth.merge.self_link");
    expect(row).toMatchObject({ userId: "web", entityId: "web" });
    expect((row!.metadata as Record<string, unknown>).source).toBe("self_link");
    expect(user(tables, "web").telegramId).toBe("4343");
  });

  it("AC-E2.10 clients_only (mergeClients): legacy texts for staff accounts and a silent Telegram conflict", async () => {
    const tables = install({
      user: [
        makeUser({ id: "c1", telegramId: "1" }),
        makeUser({ id: "c2", telegramId: "2" }),
        makeUser({ id: "m", role: "MANAGER" }),
      ],
    });
    await expect(mergeClients("m", "c1", "admin")).rejects.toThrow("Основной аккаунт не является клиентом");
    await expect(mergeClients("c1", "m", "admin")).rejects.toThrow("Второй аккаунт не является клиентом");

    const result = await mergeClients("c1", "c2", "admin");
    expect(result).toMatchObject({ primaryId: "c1", tombstonedUserId: "c2", deletedUserId: "c2" });
    expect(user(tables, "c1").telegramId).toBe("1");
    const meta = tables.auditLog.find((a) => a.action === "auth.merge.manual")!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ mode: "clients_only", source: "admin_ui" });
  });
});

describe("previewAccountMerge (AC-E2.3)", () => {
  function staffPair(): Tables {
    return install({
      module: modules(),
      user: [
        actor(),
        makeUser({ id: "p-adm", role: "ADMIN", name: "Админ", email: "a@x.ru", telegramId: "1001", createdAt: new Date("2026-03-01") }),
        makeUser({ id: "s-mgr", role: "MANAGER", name: "Менеджер", email: "m@x.ru", telegramId: "2002", phone: "+79990000002" }),
      ],
      adminPermission: [
        { id: "ap1", userId: "p-adm", section: "analytics" },
        { id: "ap2", userId: "s-mgr", section: "cafe" },
      ],
      moduleAssignment: [{ id: "ma1", userId: "s-mgr", moduleId: "mod-cafe" }],
      moduleNotificationRecipient: [{ moduleSlug: "gazebos", userId: "s-mgr" }],
      notificationEventPreference: [
        { id: "n1", userId: "p-adm", eventType: "booking.created", enabled: true },
        { id: "n2", userId: "s-mgr", eventType: "booking.created", enabled: false },
        { id: "n3", userId: "s-mgr", eventType: "order.placed", enabled: true },
      ],
      userNotificationChannel: [
        { id: "c1", userId: "p-adm", kind: "TELEGRAM", address: "1001" },
        { id: "c2", userId: "s-mgr", kind: "TELEGRAM", address: "2002" },
      ],
      booking: [{ id: "b1", userId: "s-mgr" }],
      order: [{ id: "o1", userId: "s-mgr" }],
      auditLog: [{ id: "al", userId: "s-mgr" }],
      inAppNotification: [{ id: "ia", userId: "s-mgr" }],
    });
  }

  it("AC-E2.3: shows result, conflicts, access, subscriptions, counters and «Не будут перенесены» — and changes nothing", async () => {
    const tables = staffPair();
    const before = structuredClone(tables);

    const preview = await previewAccountMerge({ primaryId: "p-adm", secondaryId: "s-mgr", actorId: "sa-actor", mode: "admin" });

    // Reads create empty arrays in the stand-in; compare the data only.
    const data = (t: Tables) => Object.fromEntries(Object.entries(t).filter(([, rows]) => rows.length > 0));
    expect(data(tables)).toEqual(data(before));
    expect(preview.suggestedPrimaryId).toBe("p-adm");
    expect(preview.result).toEqual({
      role: "ADMIN",
      name: "Админ",
      email: "a@x.ru",
      phone: "+79990000002",
      telegramLinked: true,
      vkLinked: false,
    });
    expect(preview.conflicts.map((c) => [c.field, c.requiresConfirmation])).toEqual([
      ["email", false],
      ["telegram", true],
      ["name", false],
    ]);
    expect(preview.access.sections).toEqual(expect.arrayContaining(["Аналитика", "Барбекю Парк", "Плей Парк", "Склад"]));
    expect(preview.access.recipientLists).toEqual(["Барбекю Парк"]);
    expect(preview.subscriptions.moved).toHaveLength(1);
    expect(preview.subscriptions.droppedConflicts).toHaveLength(1);
    expect(preview.channels).toEqual({ kept: ["Telegram"], moved: ["Telegram"], duplicates: [] });
    expect(preview.transfer).toEqual({ bookings: 1, orders: 1, subscriptions: 0, tasks: 0, chatMessages: 0, auditLogs: 1, notifications: 1 });
    expect(preview.notTransferred).toEqual([
      { key: "secondaryRole", label: "Роль второго аккаунта", items: ["Менеджер"] },
      { key: "sections", label: "Разделы админки второго аккаунта", items: ["Кафе"] },
      { key: "modules", label: "Назначения на модули второго аккаунта", items: ["Кафе"] },
    ]);
    expect(preview.blockers).toEqual([]);
    expect(JSON.stringify(preview)).not.toMatch(/1001|2002/);
  });

  it("lists the guards as blockers instead of throwing", async () => {
    install({
      user: [
        makeUser({ id: "sa-actor", role: "SUPERADMIN", telegramId: SEEDED_TG }),
        makeUser({ id: "p" }),
      ],
      subscription: [
        { id: "s1", userId: "p", status: "ACTIVE" },
        { id: "s2", userId: "sa-actor", status: "ACTIVE" },
      ],
    });
    const preview = await previewAccountMerge({ primaryId: "p", secondaryId: "sa-actor", actorId: "sa-actor", mode: "admin" });
    expect(preview.blockers.map((b) => b.code)).toEqual([
      "SECONDARY_IS_ACTOR",
      "SECONDARY_SEEDED_SUPERADMIN",
      "LAST_SUPERADMIN",
      "ACTIVE_SUBSCRIPTION_CONFLICT",
    ]);
    expect(preview.blockers[0].message).toBe("Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным");
  });

  it("ALREADY_MERGED blocker; SAME_ACCOUNT / USER_NOT_FOUND errors", async () => {
    install({ user: [actor(), makeUser({ id: "a" }), makeUser({ id: "gone", mergedIntoUserId: "a" })] });
    const preview = await previewAccountMerge({ primaryId: "a", secondaryId: "gone", actorId: "sa-actor", mode: "admin" });
    expect(preview.blockers.map((b) => b.code)).toEqual(["ALREADY_MERGED"]);
    await expectCode(previewAccountMerge({ primaryId: "a", secondaryId: "a", actorId: "sa-actor", mode: "admin" }), "SAME_ACCOUNT", 422);
    await expectCode(previewAccountMerge({ primaryId: "a", secondaryId: "x", actorId: "sa-actor", mode: "admin" }), "USER_NOT_FOUND", 404);
  });
});

describe("searchMergeCandidates (AC-E2.1)", () => {
  it("finds by name / email / phone / Telegram ID, skips merged, system and the excluded id, never returns telegramId", async () => {
    install({
      user: [
        makeUser({ id: "system", role: "SUPERADMIN", name: "Иван system" }),
        makeUser({ id: "a", name: "Иван Петров", email: "ivan@x.ru", telegramId: "100500" }),
        makeUser({ id: "b", name: "Пётр", phone: "+79161234567", phoneNormalized: "+79161234567" }),
        makeUser({ id: "gone", name: "Иван старый", mergedIntoUserId: "a" }),
      ],
    });
    expect((await searchMergeCandidates("иван")).map((u) => u.id)).toEqual(["a"]);
    expect((await searchMergeCandidates("916 123-45-67")).map((u) => u.id)).toEqual(["b"]);
    expect((await searchMergeCandidates("100500")).map((u) => u.id)).toEqual(["a"]);
    expect(await searchMergeCandidates("иван", "a")).toEqual([]);
    const [hit] = await searchMergeCandidates("ivan@");
    expect(hit).toEqual({ id: "a", name: "Иван Петров", role: "USER", email: "ivan@x.ru", phone: null, hasTelegram: true });
  });
});
