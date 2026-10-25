import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Смена роли — ADR 2026-10-25-team-access-notifications §5.1/§10, PRD US-A2.
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

import { changeUserRole } from "@/modules/users/exclusion";
import { DomainError } from "@/modules/users/errors";

type Role = "SUPERADMIN" | "ADMIN" | "MANAGER" | "USER";
const row = (id: string, role: Role, extra: { telegramId?: string; mergedIntoUserId?: string } = {}) => ({
  id,
  name: null,
  role,
  telegramId: extra.telegramId ?? null,
  mergedIntoUserId: extra.mergedIntoUserId ?? null,
});

function givenCurrentRole(role: Role, extra: { mergedIntoUserId?: string } = {}) {
  mockPrisma.user.findUnique.mockResolvedValue({ role, mergedIntoUserId: extra.mergedIntoUserId ?? null });
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPERADMIN_TELEGRAM_ID", "999000");
  mockPrisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
  mockBump.mockResolvedValue(1);
  mockPublish.mockResolvedValue(undefined);
  mockEnsure.mockResolvedValue(undefined);
  tx.user.update.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
  tx.auditLog.findFirst.mockResolvedValue(null);
  tx.adminPermission.upsert.mockResolvedValue({});
  for (const model of [
    tx.adminPermission,
    tx.moduleAssignment,
    tx.moduleNotificationRecipient,
    tx.notificationEventPreference,
  ]) {
    model.findMany.mockResolvedValue([]);
    model.deleteMany.mockResolvedValue({ count: 0 });
  }
  tx.notificationPreference.updateMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("changeUserRole → USER (AC-A2.1)", () => {
  it("AC-A2.1: team → USER runs the exclusion (same result, audited via role_change)", async () => {
    givenCurrentRole("MANAGER");
    tx.$queryRaw.mockResolvedValue([row("mgr-1", "MANAGER"), row("sa-1", "SUPERADMIN")]);

    const result = await changeUserRole("mgr-1", "USER", "sa-1");

    expect(result.kind).toBe("excluded");
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "mgr-1" }, data: { role: "USER" } });
    expect(tx.moduleNotificationRecipient.deleteMany).toHaveBeenCalledWith({ where: { userId: "mgr-1" } });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "user.team.exclude",
      metadata: { previousRole: "MANAGER", via: "role_change" },
    });
    expect(mockBump).toHaveBeenCalledWith(tx, "mgr-1");
    expect(mockPublish).toHaveBeenCalledWith("mgr-1");
  });

  it("AC-A2.1: guards apply — last superadmin cannot be made USER", async () => {
    givenCurrentRole("SUPERADMIN");
    tx.$queryRaw.mockResolvedValue([row("sa-1", "SUPERADMIN")]);

    const error = await rejection(changeUserRole("sa-1", "USER", "sa-0"));

    expect(error.code).toBe("LAST_SUPERADMIN");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("AC-A2.1: seeded superadmin → USER requires confirmation", async () => {
    givenCurrentRole("SUPERADMIN");
    tx.$queryRaw.mockResolvedValue([row("sa-1", "SUPERADMIN"), row("sa-seed", "SUPERADMIN", { telegramId: "999000" })]);

    const error = await rejection(changeUserRole("sa-seed", "USER", "sa-1"));
    expect(error.code).toBe("SEEDED_SUPERADMIN_CONFIRM_REQUIRED");

    const ok = await changeUserRole("sa-seed", "USER", "sa-1", { confirmSeeded: true });
    expect(ok.kind).toBe("excluded");
  });

  it("CANNOT_DEMOTE_SELF before any write", async () => {
    givenCurrentRole("SUPERADMIN");
    const error = await rejection(changeUserRole("sa-1", "USER", "sa-1"));
    expect(error.code).toBe("CANNOT_DEMOTE_SELF");
    expect(error.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("changeUserRole — понижение (AC-A2.2)", () => {
  it("AC-A2.2: SUPERADMIN → ADMIN bumps the session version and audits old → new", async () => {
    givenCurrentRole("SUPERADMIN");
    tx.$queryRaw.mockResolvedValue([row("sa-1", "SUPERADMIN"), row("sa-2", "SUPERADMIN")]);

    const result = await changeUserRole("sa-2", "ADMIN", "sa-1");

    expect(result).toEqual({ kind: "demoted", oldRole: "SUPERADMIN", newRole: "ADMIN", sessionsRevoked: true });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "sa-2" }, data: { role: "ADMIN" } });
    expect(mockBump).toHaveBeenCalledWith(tx, "sa-2");
    expect(tx.adminPermission.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "sa-1",
        action: "user.role.change",
        entity: "User",
        entityId: "sa-2",
        metadata: { oldRole: "SUPERADMIN", newRole: "ADMIN", demotion: true },
      },
    });
    expect(mockPublish).toHaveBeenCalledWith("sa-2");
    expect(mockPublish.mock.invocationCallOrder[0]).toBeGreaterThan(mockBump.mock.invocationCallOrder[0]);
    // Demotion is not an exclusion: grants, lists and subscriptions stay.
    expect(tx.adminPermission.deleteMany).not.toHaveBeenCalled();
    expect(tx.moduleNotificationRecipient.deleteMany).not.toHaveBeenCalled();
  });

  it("AC-A2.2: ADMIN → MANAGER bumps and keeps the «Дашборд» entry point", async () => {
    givenCurrentRole("ADMIN");
    tx.$queryRaw.mockResolvedValue([row("adm-1", "ADMIN"), row("sa-1", "SUPERADMIN")]);

    await changeUserRole("adm-1", "MANAGER", "sa-1");

    expect(mockBump).toHaveBeenCalledWith(tx, "adm-1");
    expect(tx.adminPermission.upsert).toHaveBeenCalledWith({
      where: { userId_section: { userId: "adm-1", section: "dashboard" } },
      create: { userId: "adm-1", section: "dashboard" },
      update: {},
    });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({
      oldRole: "ADMIN",
      newRole: "MANAGER",
      demotion: true,
    });
  });

  it("LAST_SUPERADMIN cannot be demoted (merged / system do not count)", async () => {
    givenCurrentRole("SUPERADMIN");
    tx.$queryRaw.mockResolvedValue([
      row("sa-1", "SUPERADMIN"),
      row("sa-old", "SUPERADMIN", { mergedIntoUserId: "sa-1" }),
      row("system", "SUPERADMIN"),
    ]);

    const error = await rejection(changeUserRole("sa-1", "ADMIN", "sa-0"));

    expect(error.code).toBe("LAST_SUPERADMIN");
    expect(error.message).toBe("Нельзя понизить последнего суперадмина. Сначала назначьте другого");
    expect(mockBump).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("AC-A1.7: seeded superadmin demotion needs confirmSeeded", async () => {
    givenCurrentRole("SUPERADMIN");
    tx.$queryRaw.mockResolvedValue([row("sa-1", "SUPERADMIN"), row("sa-seed", "SUPERADMIN", { telegramId: "999000" })]);

    const error = await rejection(changeUserRole("sa-seed", "MANAGER", "sa-1"));
    expect(error.code).toBe("SEEDED_SUPERADMIN_CONFIRM_REQUIRED");
    expect(tx.user.update).not.toHaveBeenCalled();

    await changeUserRole("sa-seed", "MANAGER", "sa-1", { confirmSeeded: true });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "sa-seed" }, data: { role: "MANAGER" } });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      demotion: true,
      seededSuperadmin: true,
      confirmedSeeded: true,
    });
  });

  it("CANNOT_DEMOTE_SELF for any lower role", async () => {
    givenCurrentRole("SUPERADMIN");
    const error = await rejection(changeUserRole("sa-1", "ADMIN", "sa-1"));
    expect(error.code).toBe("CANNOT_DEMOTE_SELF");
  });

  it("ROLE_CHANGED_CONCURRENTLY when the locked row no longer has the role read before", async () => {
    givenCurrentRole("ADMIN");
    tx.$queryRaw.mockResolvedValue([row("adm-1", "MANAGER"), row("sa-1", "SUPERADMIN")]);

    const error = await rejection(changeUserRole("adm-1", "MANAGER", "sa-1"));

    expect(error.code).toBe("ROLE_CHANGED_CONCURRENTLY");
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe("changeUserRole — повышение (AC-A2.4, регрессия)", () => {
  it("AC-A2.4: USER → MANAGER: «Дашборд» + release subscription by default, audit old → new, no bump", async () => {
    givenCurrentRole("USER");
    tx.$queryRaw.mockResolvedValue([row("u-1", "USER")]);

    const result = await changeUserRole("u-1", "MANAGER", "sa-1");

    expect(result).toEqual({ kind: "promoted", oldRole: "USER", newRole: "MANAGER" });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u-1" }, data: { role: "MANAGER" } });
    expect(tx.adminPermission.upsert).toHaveBeenCalledWith({
      where: { userId_section: { userId: "u-1", section: "dashboard" } },
      create: { userId: "u-1", section: "dashboard" },
      update: {},
    });
    expect(mockEnsure).toHaveBeenCalledWith("u-1");
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "sa-1",
        action: "user.role.change",
        entity: "User",
        entityId: "u-1",
        metadata: { oldRole: "USER", newRole: "MANAGER" },
      },
    });
    expect(mockBump).not.toHaveBeenCalled();
    // Promotion locks only the target row.
    const [strings] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(strings.join("?")).not.toContain("SUPERADMIN");
  });

  it("AC-A2.4: USER → SUPERADMIN subscribes to releases, no «Дашборд» grant", async () => {
    givenCurrentRole("USER");
    tx.$queryRaw.mockResolvedValue([row("u-1", "USER")]);

    await changeUserRole("u-1", "SUPERADMIN", "sa-1");

    expect(mockEnsure).toHaveBeenCalledWith("u-1");
    expect(tx.adminPermission.upsert).not.toHaveBeenCalled();
  });

  it("MANAGER → SUPERADMIN does not touch release defaults (already staff)", async () => {
    givenCurrentRole("MANAGER");
    tx.$queryRaw.mockResolvedValue([row("mgr-1", "MANAGER")]);

    await changeUserRole("mgr-1", "SUPERADMIN", "sa-1");

    expect(mockEnsure).not.toHaveBeenCalled();
    expect(tx.adminPermission.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({
      oldRole: "MANAGER",
      newRole: "SUPERADMIN",
    });
  });

  it("USER → ADMIN keeps the old behaviour: no defaults, no grant", async () => {
    givenCurrentRole("USER");
    tx.$queryRaw.mockResolvedValue([row("u-1", "USER")]);

    await changeUserRole("u-1", "ADMIN", "sa-1");

    expect(mockEnsure).not.toHaveBeenCalled();
    expect(tx.adminPermission.upsert).not.toHaveBeenCalled();
  });

  it("AC-A1.12: returning an excluded user does not restore removed grants", async () => {
    givenCurrentRole("USER");
    tx.$queryRaw.mockResolvedValue([row("u-1", "USER")]);

    await changeUserRole("u-1", "MANAGER", "sa-1");

    // Only the default «Дашборд»: nothing is read back from the exclusion record.
    expect(tx.adminPermission.upsert).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.findFirst).not.toHaveBeenCalled();
  });
});

describe("changeUserRole — прочее", () => {
  it("same role → unchanged, no transaction, no audit (AC-A2.5 only on change)", async () => {
    givenCurrentRole("MANAGER");
    const result = await changeUserRole("mgr-1", "MANAGER", "sa-1");
    expect(result.kind).toBe("unchanged");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("USER_NOT_FOUND / USER_MERGED", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    expect((await rejection(changeUserRole("x", "ADMIN", "sa-1"))).code).toBe("USER_NOT_FOUND");

    givenCurrentRole("MANAGER", { mergedIntoUserId: "mgr-2" });
    const merged = await rejection(changeUserRole("mgr-1", "ADMIN", "sa-1"));
    expect(merged.code).toBe("USER_MERGED");
    expect(merged.metadata).toEqual({ primaryUserId: "mgr-2" });
  });
});
