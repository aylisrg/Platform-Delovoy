import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * «Исключить из команды» — ADR 2026-10-25-team-access-notifications §5.1/§10,
 * PRD US-A1 (контрольный набор QA A1).
 *
 * Writes are only possible through `tx` (the interactive transaction): the
 * global prisma mock has no write methods at all, so a write outside the
 * transaction would throw. `tx` has no client-side models (channels, bookings,
 * orders, subscriptions, tasks, chats) — touching them would throw too.
 */

const { tx, mockPrisma, mockBump, mockPublish, mockEnsure } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    user: { update: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    adminPermission: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    moduleAssignment: { findMany: vi.fn(), deleteMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), deleteMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn(), deleteMany: vi.fn() },
    notificationPreference: { updateMany: vi.fn() },
  };
  const mockPrisma = {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), count: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    adminPermission: { findMany: vi.fn() },
    moduleAssignment: { findMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn() },
    taskAssignee: { count: vi.fn() },
  };
  return { tx, mockPrisma, mockBump: vi.fn(), mockPublish: vi.fn(), mockEnsure: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/session-revocation", () => ({
  bumpSessionVersion: (...args: unknown[]) => mockBump(...args),
  publishAuthState: (...args: unknown[]) => mockPublish(...args),
}));
vi.mock("@/modules/notifications/release-notify", () => ({
  ensureManagerNotifyDefaults: (...args: unknown[]) => mockEnsure(...args),
}));

import { excludeFromTeam, getExclusionPreview } from "@/modules/users/exclusion";
import { DomainError } from "@/modules/users/errors";
import { MANAGED_EVENT_TYPES } from "@/modules/notifications/catalog";

type Row = {
  id: string;
  name: string | null;
  role: "SUPERADMIN" | "ADMIN" | "MANAGER" | "USER";
  telegramId: string | null;
  mergedIntoUserId: string | null;
};

const row = (overrides: Partial<Row> & Pick<Row, "id" | "role">): Row => ({
  name: null,
  telegramId: null,
  mergedIntoUserId: null,
  ...overrides,
});

const MANAGER = row({ id: "mgr-1", name: "Иван", role: "MANAGER", telegramId: "111" });
const SUPERADMIN = row({ id: "sa-1", name: "Владелец", role: "SUPERADMIN", telegramId: "222" });

/** QA A1: 3 sections, 2 modules, 2 recipient lists (one without assignment), 4 subscriptions incl. releases. */
function seedControlSet() {
  tx.adminPermission.findMany.mockResolvedValue([
    { section: "dashboard" },
    { section: "cafe" },
    { section: "tasks" },
  ]);
  tx.moduleAssignment.findMany.mockResolvedValue([
    { module: { slug: "cafe" } },
    { module: { slug: "gazebos" } },
  ]);
  tx.moduleNotificationRecipient.findMany.mockResolvedValue([
    { moduleSlug: "cafe" },
    { moduleSlug: "rental" },
  ]);
  tx.notificationEventPreference.findMany.mockResolvedValue([
    { eventType: "order.placed" },
    { eventType: "order.cancelled" },
    { eventType: "booking.created" },
    { eventType: "system.release" },
  ]);
}

function sqlOf(call: unknown[]): string {
  const [strings] = call as [TemplateStringsArray, ...unknown[]];
  return strings.join("?");
}

async function expectDomainError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  expect((error as DomainError).status).toBe(status);
  return error as DomainError;
}

function expectNoWrites() {
  expect(tx.user.update).not.toHaveBeenCalled();
  expect(mockBump).not.toHaveBeenCalled();
  expect(tx.adminPermission.deleteMany).not.toHaveBeenCalled();
  expect(tx.moduleAssignment.deleteMany).not.toHaveBeenCalled();
  expect(tx.moduleNotificationRecipient.deleteMany).not.toHaveBeenCalled();
  expect(tx.notificationEventPreference.deleteMany).not.toHaveBeenCalled();
  expect(tx.notificationPreference.updateMany).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPERADMIN_TELEGRAM_ID", "999000");
  mockPrisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
  mockBump.mockResolvedValue(1);
  mockPublish.mockResolvedValue(undefined);
  tx.user.update.mockResolvedValue({});
  tx.auditLog.findFirst.mockResolvedValue(null);
  tx.auditLog.create.mockResolvedValue({});
  tx.adminPermission.deleteMany.mockResolvedValue({ count: 0 });
  tx.moduleAssignment.deleteMany.mockResolvedValue({ count: 0 });
  tx.moduleNotificationRecipient.deleteMany.mockResolvedValue({ count: 0 });
  tx.notificationEventPreference.deleteMany.mockResolvedValue({ count: 0 });
  tx.notificationPreference.updateMany.mockResolvedValue({ count: 1 });
  tx.adminPermission.findMany.mockResolvedValue([]);
  tx.moduleAssignment.findMany.mockResolvedValue([]);
  tx.moduleNotificationRecipient.findMany.mockResolvedValue([]);
  tx.notificationEventPreference.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("excludeFromTeam — контрольный набор QA A1", () => {
  beforeEach(() => {
    tx.$queryRaw.mockResolvedValue([MANAGER, SUPERADMIN]);
    seedControlSet();
  });

  it("AC-A1.3: role → USER, every staff grant deleted with exact where-clauses", async () => {
    const result = await excludeFromTeam("mgr-1", "sa-1", { via: "exclude" });

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "mgr-1" }, data: { role: "USER" } });
    expect(tx.adminPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: "mgr-1" } });
    expect(tx.moduleAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: "mgr-1" } });
    // All modules' recipient lists — including «rental» without an assignment.
    expect(tx.moduleNotificationRecipient.deleteMany).toHaveBeenCalledWith({ where: { userId: "mgr-1" } });

    expect(result).toEqual({
      userId: "mgr-1",
      role: "USER",
      removed: {
        sections: ["dashboard", "cafe", "tasks"],
        modules: ["cafe", "gazebos"],
        recipientLists: ["cafe", "rental"],
        subscriptions: ["order.placed", "order.cancelled", "booking.created", "system.release"],
      },
      sessionsRevoked: true,
    });
  });

  it("AC-A1.3 (5) / AC-A1.4: subscriptions are deleted only for catalog event types; release mirror off", async () => {
    await excludeFromTeam("mgr-1", "sa-1", { via: "exclude" });

    expect(tx.notificationEventPreference.deleteMany).toHaveBeenCalledWith({
      where: { userId: "mgr-1", eventType: { in: [...MANAGED_EVENT_TYPES] } },
    });
    expect(tx.notificationEventPreference.findMany).toHaveBeenCalledWith({
      where: { userId: "mgr-1", eventType: { in: [...MANAGED_EVENT_TYPES] } },
      select: { eventType: true },
    });
    // Only the «Релизы» mirror — client enable* flags are not part of the update.
    expect(tx.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: { userId: "mgr-1" },
      data: { notifyReleases: false },
    });
  });

  it("AC-A1.5: session version bumped inside the transaction, state published after commit", async () => {
    await excludeFromTeam("mgr-1", "sa-1", { via: "exclude" });

    expect(mockBump).toHaveBeenCalledWith(tx, "mgr-1");
    expect(mockPublish).toHaveBeenCalledWith("mgr-1");
    expect(mockPublish.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.auditLog.create.mock.invocationCallOrder[0],
    );
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
  });

  it("AC-A1.9: exactly one audit row with actor, previous role and removed lists (no contacts)", async () => {
    await excludeFromTeam("mgr-1", "sa-1", { via: "exclude" });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "sa-1",
        action: "user.team.exclude",
        entity: "User",
        entityId: "mgr-1",
        metadata: {
          previousRole: "MANAGER",
          via: "exclude",
          removed: {
            sections: ["dashboard", "cafe", "tasks"],
            modules: ["cafe", "gazebos"],
            recipientLists: ["cafe", "rental"],
            subscriptions: ["order.placed", "order.cancelled", "booking.created", "system.release"],
          },
          seededSuperadmin: false,
          confirmedSeeded: false,
        },
      },
    });
    const metadata = JSON.stringify(tx.auditLog.create.mock.calls[0][0].data.metadata);
    expect(metadata).not.toMatch(/email|phone|telegram/i);
  });

  it("AC-A1.3: target and superadmins are locked FOR UPDATE in one ordered statement", async () => {
    await excludeFromTeam("mgr-1", "sa-1", { via: "exclude" });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const call = tx.$queryRaw.mock.calls[0];
    const sql = sqlOf(call);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain('ORDER BY "id"');
    expect(sql).toContain(`"role" = 'SUPERADMIN'`);
    expect(sql).toContain(`"mergedIntoUserId" IS NULL`);
    expect(sql).toContain(`"id" <> 'system'`);
    expect(sql).not.toMatch(/email|phone/);
    expect(call.slice(1)).toEqual(["mgr-1"]);
  });

  it("AC-A1.3: a failure on any step propagates out of the transaction (rollback) and nothing is published", async () => {
    tx.moduleNotificationRecipient.deleteMany.mockRejectedValue(new Error("db down"));

    await expect(excludeFromTeam("mgr-1", "sa-1", { via: "exclude" })).rejects.toThrow("db down");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("via role_change is recorded in the audit row (AC-A2.1)", async () => {
    await excludeFromTeam("mgr-1", "sa-1", { via: "role_change" });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata.via).toBe("role_change");
  });
});

describe("excludeFromTeam — гарды (AC-A1.6, AC-A1.8)", () => {
  it("AC-A1.6: CANNOT_EXCLUDE_SELF without opening a transaction", async () => {
    const error = await expectDomainError(
      excludeFromTeam("sa-1", "sa-1", { via: "exclude" }),
      "CANNOT_EXCLUDE_SELF",
      400,
    );
    expect(error.message).toBe("Нельзя исключить самого себя");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("USER_NOT_FOUND when the target row is gone", async () => {
    tx.$queryRaw.mockResolvedValue([SUPERADMIN]);
    await expectDomainError(excludeFromTeam("ghost", "sa-1", { via: "exclude" }), "USER_NOT_FOUND", 404);
    expectNoWrites();
  });

  it("USER_MERGED for a tombstoned account, with the primary id", async () => {
    tx.$queryRaw.mockResolvedValue([row({ id: "mgr-1", role: "MANAGER", mergedIntoUserId: "mgr-2" }), SUPERADMIN]);
    const error = await expectDomainError(
      excludeFromTeam("mgr-1", "sa-1", { via: "exclude" }),
      "USER_MERGED",
      409,
    );
    expect(error.metadata).toEqual({ primaryUserId: "mgr-2" });
    expectNoWrites();
  });

  it("AC-A1.6: NOT_IN_TEAM for a client that was never excluded — nothing written", async () => {
    tx.$queryRaw.mockResolvedValue([row({ id: "u-1", role: "USER" }), SUPERADMIN]);
    tx.auditLog.findFirst.mockResolvedValue(null);

    const error = await expectDomainError(
      excludeFromTeam("u-1", "sa-1", { via: "exclude" }),
      "NOT_IN_TEAM",
      409,
    );
    expect(error.message).toBe("Пользователь не входит в команду");
    expectNoWrites();
  });

  it("AC-A1.8: ALREADY_EXCLUDED (no second audit row) when an exclusion is on record", async () => {
    tx.$queryRaw.mockResolvedValue([row({ id: "mgr-1", role: "USER" }), SUPERADMIN]);
    tx.auditLog.findFirst.mockResolvedValue({ id: "log-1" });

    const error = await expectDomainError(
      excludeFromTeam("mgr-1", "sa-1", { via: "exclude" }),
      "ALREADY_EXCLUDED",
      409,
    );
    expect(error.message).toBe("Пользователь уже не входит в команду");
    expect(tx.auditLog.findFirst).toHaveBeenCalledWith({
      where: { action: "user.team.exclude", entity: "User", entityId: "mgr-1" },
      select: { id: true },
    });
    expectNoWrites();
  });

  it("AC-A1.8: concurrent second call sees USER after the lock → ALREADY_EXCLUDED, one execution only", async () => {
    seedControlSet();
    tx.$queryRaw
      .mockResolvedValueOnce([MANAGER, SUPERADMIN])
      .mockResolvedValueOnce([row({ id: "mgr-1", role: "USER" }), SUPERADMIN]);
    tx.auditLog.findFirst.mockResolvedValue({ id: "log-1" });

    const [first, second] = await Promise.allSettled([
      excludeFromTeam("mgr-1", "sa-1", { via: "exclude" }),
      excludeFromTeam("mgr-1", "sa-2", { via: "exclude" }),
    ]);

    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect((second as PromiseRejectedResult).reason).toMatchObject({ code: "ALREADY_EXCLUDED" });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("AC-A1.6: LAST_SUPERADMIN — merged and `system` superadmins do not count", async () => {
    tx.$queryRaw.mockResolvedValue([
      row({ id: "sa-merged", role: "SUPERADMIN", mergedIntoUserId: "sa-1" }),
      SUPERADMIN,
      row({ id: "system", role: "SUPERADMIN" }),
    ]);

    const error = await expectDomainError(
      excludeFromTeam("sa-1", "sa-0", { via: "exclude" }),
      "LAST_SUPERADMIN",
      409,
    );
    expect(error.message).toBe("Нельзя исключить последнего суперадмина. Сначала назначьте другого");
    expectNoWrites();
  });

  it("a superadmin can be excluded while another active superadmin exists", async () => {
    tx.$queryRaw.mockResolvedValue([SUPERADMIN, row({ id: "sa-2", role: "SUPERADMIN" })]);

    await excludeFromTeam("sa-1", "sa-2", { via: "exclude" });

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "sa-1" }, data: { role: "USER" } });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata.previousRole).toBe("SUPERADMIN");
  });

  it("AC-A1.7: seeded superadmin without confirmation → SEEDED_SUPERADMIN_CONFIRM_REQUIRED, nothing written", async () => {
    const seeded = row({ id: "sa-seed", role: "SUPERADMIN", telegramId: "999000" });
    tx.$queryRaw.mockResolvedValue([SUPERADMIN, seeded]);

    const error = await expectDomainError(
      excludeFromTeam("sa-seed", "sa-1", { via: "exclude" }),
      "SEEDED_SUPERADMIN_CONFIRM_REQUIRED",
      409,
    );
    expect(error.metadata).toEqual({ requiresConfirmation: "seeded_superadmin" });
    expect(error.message).toContain("назначен суперадмином в настройках сервера");
    expect(error.message).not.toContain("999000");
    expectNoWrites();
  });

  it("AC-A1.7: seeded superadmin with «Всё равно исключить» → excluded, flags in the audit row", async () => {
    const seeded = row({ id: "sa-seed", role: "SUPERADMIN", telegramId: "999000" });
    tx.$queryRaw.mockResolvedValue([SUPERADMIN, seeded]);

    await excludeFromTeam("sa-seed", "sa-1", { via: "exclude", confirmSeeded: true });

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "sa-seed" }, data: { role: "USER" } });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      seededSuperadmin: true,
      confirmedSeeded: true,
    });
  });
});

describe("getExclusionPreview (AC-A1.2)", () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...MANAGER });
    mockPrisma.adminPermission.findMany.mockResolvedValue([{ section: "dashboard" }, { section: "cafe" }]);
    mockPrisma.moduleAssignment.findMany.mockResolvedValue([{ module: { slug: "cafe", name: "Кафе" } }]);
    mockPrisma.moduleNotificationRecipient.findMany.mockResolvedValue([
      { moduleSlug: "cafe", module: { name: "Кафе" } },
      { moduleSlug: "rental", module: { name: "Аренда офисов" } },
    ]);
    mockPrisma.notificationEventPreference.findMany.mockResolvedValue([{ eventType: "system.release" }]);
    mockPrisma.taskAssignee.count.mockResolvedValue(3);
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);
  });

  it("AC-A1.2: counts and human labels of what is removed, open tasks, no guard", async () => {
    const preview = await getExclusionPreview("mgr-1", "sa-1");

    expect(preview).toEqual({
      user: { id: "mgr-1", name: "Иван", role: "MANAGER" },
      isSeededSuperadmin: false,
      removes: {
        sectionsByRole: [],
        explicitSections: ["Дашборд", "Кафе"],
        modules: ["Кафе"],
        recipientLists: ["Кафе", "Аренда офисов"],
        subscriptions: ["Релизы платформы"],
      },
      counts: { sections: 2, modules: 1, recipientLists: 2, subscriptions: 1 },
      openAssignedTasks: 3,
      guard: null,
    });
    expect(mockPrisma.taskAssignee.count).toHaveBeenCalledWith({
      where: {
        userId: "mgr-1",
        role: { in: ["RESPONSIBLE", "COLLABORATOR"] },
        task: { closedAt: null, deletedAt: null },
      },
    });
  });

  it("preview never writes", async () => {
    await getExclusionPreview("mgr-1", "sa-1");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("superadmin: role sections are listed separately from explicit grants", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...SUPERADMIN });
    mockPrisma.adminPermission.findMany.mockResolvedValue([{ section: "nedelovoy" }]);

    const preview = await getExclusionPreview("sa-1", "sa-2");

    expect(preview.removes.explicitSections).toEqual(["НеДеловой"]);
    expect(preview.removes.sectionsByRole).toContain("Звонки");
    expect(preview.removes.sectionsByRole).not.toContain("НеДеловой");
    expect(preview.counts.sections).toBe(preview.removes.sectionsByRole.length + 1);
  });

  it("AC-A1.6: guard CANNOT_EXCLUDE_SELF", async () => {
    const preview = await getExclusionPreview("mgr-1", "mgr-1");
    expect(preview.guard).toEqual({ code: "CANNOT_EXCLUDE_SELF", message: "Нельзя исключить самого себя" });
  });

  it("AC-A1.6: guard NOT_IN_TEAM / AC-A1.8: ALREADY_EXCLUDED for a USER", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(row({ id: "u-1", role: "USER" }));
    expect((await getExclusionPreview("u-1", "sa-1")).guard?.code).toBe("NOT_IN_TEAM");

    mockPrisma.auditLog.findFirst.mockResolvedValue({ id: "log-1" });
    expect((await getExclusionPreview("u-1", "sa-1")).guard?.code).toBe("ALREADY_EXCLUDED");
  });

  it("AC-A1.6: guard LAST_SUPERADMIN counts only active, non-system superadmins", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...SUPERADMIN });
    mockPrisma.user.count.mockResolvedValue(0);

    const preview = await getExclusionPreview("sa-1", "sa-0");

    expect(preview.guard?.code).toBe("LAST_SUPERADMIN");
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { role: "SUPERADMIN", mergedIntoUserId: null, id: { notIn: ["system", "sa-1"] } },
    });
  });

  it("AC-A1.7: flags a seeded superadmin without exposing the Telegram id", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(row({ id: "sa-seed", role: "SUPERADMIN", telegramId: "999000" }));
    const preview = await getExclusionPreview("sa-seed", "sa-1");
    expect(preview.isSeededSuperadmin).toBe(true);
    expect(JSON.stringify(preview)).not.toContain("999000");
  });

  it("404 USER_NOT_FOUND and 409 USER_MERGED", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expectDomainError(getExclusionPreview("ghost", "sa-1"), "USER_NOT_FOUND", 404);

    mockPrisma.user.findUnique.mockResolvedValueOnce(row({ id: "x", role: "MANAGER", mergedIntoUserId: "y" }));
    await expectDomainError(getExclusionPreview("x", "sa-1"), "USER_MERGED", 409);
  });
});
