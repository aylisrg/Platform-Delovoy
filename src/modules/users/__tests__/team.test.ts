import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    mergeCandidate: { count: vi.fn(), findMany: vi.fn() },
  },
}));
const mockExplain = vi.fn();
vi.mock("@/modules/notifications/explain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/notifications/explain")>()),
  explainStaffNotifications: (...a: unknown[]) => mockExplain(...a),
}));
vi.mock("@/modules/telegram-link/bot-contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/telegram-link/bot-contact")>()),
  getBotContacts: vi.fn().mockResolvedValue(new Map()),
  getBotTrackingSince: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "@/lib/db";
import type { StaffNotificationExplain, ExplainEvent } from "@/modules/notifications/explain";
import { countSubscriptions, describeSections, getTeamOverview, getUserOverview, teamFlags } from "../team";

const NOW = new Date("2026-10-25T10:00:00Z");

function ev(status: ExplainEvent["status"], extra: Partial<ExplainEvent> = {}): ExplainEvent {
  return {
    eventType: "booking.created", label: "", description: "", status,
    toggle: { enabled: status === "RECEIVES" || status === "BLOCKED", editable: status !== "NO_ACCESS", source: "default" },
    paths: [], contexts: [], deliveryChannels: [], blockers: [], notes: [], lastChange: null, ...extra,
  };
}

function explainOf(events: ExplainEvent[], botStatus: StaffNotificationExplain["botStatus"] = { state: "STARTED", startedAt: null }): StaffNotificationExplain {
  return {
    userId: "u", role: "MANAGER", botStatus, channels: [], globalNotes: [],
    categories: [{ key: "bookings", label: "", description: "", icon: "", delivery: "personal", access: { ok: true }, groupChat: [], events }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mergeCandidate.count).mockResolvedValue(0);
  vi.mocked(prisma.mergeCandidate.findMany).mockResolvedValue([]);
});

describe("describeSections (AC-B1.4)", () => {
  it("marks the source of every effective section", () => {
    expect(describeSections("ADMIN", ["cafe", "nedelovoy"])).toEqual([
      { slug: "cafe", label: "Кафе", source: "grant" },
      { slug: "nedelovoy", label: "НеДеловой", source: "strict_grant" },
      { slug: "gazebos", label: "Барбекю Парк", source: "role" },
      { slug: "ps-park", label: "Плей Парк", source: "role" },
      { slug: "inventory", label: "Склад", source: "role" },
    ]);
    expect(describeSections("SUPERADMIN", []).every((s) => s.source === "role")).toBe(true);
    expect(describeSections("MANAGER", [])).toEqual([]);
  });
});

describe("countSubscriptions / teamFlags (AC-B2.2, AC-B2.3)", () => {
  it("«N из M»: M = events with access, N = events with a route", () => {
    expect(countSubscriptions(explainOf([ev("RECEIVES"), ev("BLOCKED"), ev("NOT_RECEIVING"), ev("NO_ACCESS")]))).toEqual({ active: 2, available: 3 });
  });

  it("flags problems: no working channel, bot, stale login, no sections", () => {
    const blocked = explainOf([ev("BLOCKED", { blockers: [{ code: "BOT_NOT_STARTED", label: "Бот не запущен" }] })], { state: "NOT_STARTED", trackingSince: null });
    expect(
      teamFlags({ role: "MANAGER", sections: [], lastLoginAt: null, botStatus: blocked.botStatus, explain: blocked, now: NOW }),
    ).toEqual(["NO_WORKING_CHANNEL", "BOT_NOT_STARTED", "STALE_LOGIN", "NO_SECTIONS"]);

    const ok = explainOf([ev("RECEIVES")]);
    expect(
      teamFlags({ role: "ADMIN", sections: [], lastLoginAt: new Date("2026-10-20"), botStatus: ok.botStatus, explain: ok, now: NOW }),
    ).toEqual([]);
    // a DND-only block isn't a channel problem
    const dnd = explainOf([ev("BLOCKED", { blockers: [{ code: "DND", label: "Не беспокоить" }] })], { state: "BLOCKED", blockedAt: "2026-10-01T00:00:00.000Z" });
    expect(teamFlags({ role: "SUPERADMIN", sections: [], lastLoginAt: NOW, botStatus: dnd.botStatus, explain: dnd, now: NOW })).toEqual(["BOT_BLOCKED"]);
  });
});

describe("getTeamOverview (US-B2)", () => {
  const users = [
    { id: "m1", name: "Борис", image: null, role: "MANAGER", email: "b@x.ru", emailVerified: null, telegramId: null, lastLoginAt: null, adminPermissions: [], moduleAssignments: [] },
    { id: "s1", name: "Анна", image: null, role: "SUPERADMIN", email: null, emailVerified: null, telegramId: "694696", lastLoginAt: NOW, adminPermissions: [], moduleAssignments: [{ module: { slug: "gazebos", name: "Беседки" } }] },
  ];

  beforeEach(() => {
    vi.mocked(prisma.user.findMany).mockResolvedValue(users as never);
    vi.mocked(prisma.mergeCandidate.count).mockResolvedValue(2);
    mockExplain.mockResolvedValue(new Map([
      ["m1", explainOf([ev("BLOCKED", { blockers: [{ code: "NO_CHANNEL", label: "" }] })], { state: "NOT_LINKED" })],
      ["s1", explainOf([ev("RECEIVES", { eventType: "system.release" })])],
    ]));
  });

  it("only current team, not merged, not system; sorted by role then name; pending merge requests", async () => {
    const { rows, pendingMergeRequests } = await getTeamOverview({}, NOW);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] }, mergedIntoUserId: null, id: { not: "system" } },
    }));
    expect(rows.map((r) => r.id)).toEqual(["s1", "m1"]);
    expect(pendingMergeRequests).toBe(2);
    expect(rows[0]).toMatchObject({ hasTelegram: true, releases: true, isSeededSuperadmin: true, modules: [{ slug: "gazebos", name: "Беседки" }] });
    expect(rows[1].flags).toEqual(["NO_WORKING_CHANNEL", "STALE_LOGIN", "NO_SECTIONS"]);
  });

  it("filters: problems, no Telegram, bot state", async () => {
    expect((await getTeamOverview({ problems: true }, NOW)).rows.map((r) => r.id)).toEqual(["m1"]);
    expect((await getTeamOverview({ noTelegram: true }, NOW)).rows.map((r) => r.id)).toEqual(["m1"]);
    expect((await getTeamOverview({ bot: "blocked" }, NOW)).rows).toEqual([]);
  });

  it("sort by last login puts never-logged-in last", async () => {
    expect((await getTeamOverview({ sort: "lastLogin" }, NOW)).rows.map((r) => r.id)).toEqual(["s1", "m1"]);
  });
});

describe("getUserOverview (US-B1)", () => {
  const base = {
    id: "u1", name: "Иван", image: null, role: "MANAGER", createdAt: NOW, source: "telegram_bot", lastLoginAt: null,
    mergedIntoUserId: null, email: "i@x.ru", emailVerified: NOW, phone: "+7999", phoneNormalized: "79990000000",
    telegramId: "555", vkId: null, passwordHash: "secret-hash", accounts: [{ provider: "telegram-token" }],
    adminPermissions: [{ section: "cafe" }], moduleAssignments: [], notificationRecipientOf: [{ moduleSlug: "cafe" }],
  };

  it("merged account → points to the primary (AC-B1.1)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...base, mergedIntoUserId: "p1" } as never);
    expect(await getUserOverview("u1", "boss")).toEqual({ kind: "merged", primaryUserId: "p1" });
  });

  it("missing or system → USER_NOT_FOUND 404", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(getUserOverview("x", "boss")).rejects.toMatchObject({ code: "USER_NOT_FOUND", status: 404 });
  });

  it("profile without secrets (AC-B1.8), rights review, actions and duplicates", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "twin", name: "Иван 2", role: "USER" }] as never);
    const res = await getUserOverview("u1", "boss");
    expect(res.kind).toBe("user");
    const text = JSON.stringify(res);
    expect(text).not.toContain("secret-hash");
    expect(text).not.toContain('"555"');
    if (res.kind !== "user") return;
    expect(res.user).toMatchObject({ sourceLabel: "Telegram-бот", isTeamMember: true });
    expect(res.contacts).toMatchObject({ emailVerified: true, telegramLinked: true, botStatus: { state: "NOT_STARTED" } });
    expect(res.contacts.authMethods).toEqual(["telegram", "credentials", "telegram-token"]);
    expect(res.access.recipientLists).toEqual([{ moduleSlug: "cafe", label: "Кафе" }]);
    expect(res.actions).toEqual({ canExclude: true, canMerge: true, canResetPassword: true, canChangeRole: true, canDelete: true });
    expect(res.possibleDuplicates).toEqual([{ userId: "twin", name: "Иван 2", role: "USER", reason: "phone" }]);
  });

  it("self: no exclude / role change / delete", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    const res = await getUserOverview("u1", "u1");
    if (res.kind !== "user") throw new Error("expected user");
    expect(res.actions).toMatchObject({ canExclude: false, canChangeRole: false, canDelete: false });
  });
});
