import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ADMIN_SECTIONS, computeAdminSections } from "@/lib/permissions";
import { bumpSessionVersion, publishAuthState } from "@/lib/session-revocation";
import { isSeededSuperadmin } from "@/lib/seeded-superadmin";
import { MANAGED_EVENT_TYPES, NOTIFICATION_CATALOG } from "@/modules/notifications/catalog";
import { ensureManagerNotifyDefaults } from "@/modules/notifications/release-notify";
import {
  DomainError,
  USER_ERROR_MESSAGES,
  seededConfirmRequired,
  userMerged,
  userNotFound,
} from "./errors";
import {
  ROLE_RANK,
  type ChangeRoleResult,
  type ExclusionGuardCode,
  type ExclusionPreview,
  type ExclusionRemoved,
  type ExclusionResult,
  type ExclusionVia,
} from "./types";

/**
 * «Исключить из команды» и смена роли (ADR 2026-10-25-team-access-notifications
 * §5.1, PRD US-A1/US-A2).
 *
 * Исключение — одна интерактивная транзакция: строки цели и всех действующих
 * суперадминов блокируются `SELECT … FOR UPDATE`, затем роль → USER, bump
 * версии сессии и снятие всего «сотруднического». Клиентская часть аккаунта
 * (каналы доставки, клиентские уведомления, брони, заказы, абонементы, задачи,
 * чаты, журнал) не трогается (AC-A1.4).
 */

export const EXCLUDE_AUDIT_ACTION = "user.team.exclude";
export const ROLE_CHANGE_AUDIT_ACTION = "user.role.change";
export const EXCLUSION_TX_TIMEOUT_MS = 15_000;

/** Seeded system user (`scripts/seeds/core.ts`) never counts as a SUPERADMIN. */
const SYSTEM_USER_ID = "system";

const MANAGED_TYPES: string[] = [...MANAGED_EVENT_TYPES];

const SECTION_LABELS = new Map<string, string>(ADMIN_SECTIONS.map((s) => [s.slug, s.label]));
const EVENT_LABELS = new Map<string, string>(
  NOTIFICATION_CATALOG.flatMap((category) => category.events.map((e) => [e.eventType, e.label] as const)),
);

const sectionLabel = (slug: string) => SECTION_LABELS.get(slug) ?? slug;
const eventLabel = (eventType: string) => EVENT_LABELS.get(eventType) ?? eventType;

type LockedUser = {
  id: string;
  name: string | null;
  role: Role;
  telegramId: string | null;
  mergedIntoUserId: string | null;
};

/**
 * Lock the target and every active SUPERADMIN in one statement, ordered by id.
 * One ordered statement (instead of «target, then superadmins») keeps two
 * concurrent exclusions/demotions of different superadmins deadlock-free; the
 * re-check of the WHERE after a lock wait drops rows demoted meanwhile, so the
 * «last superadmin» guard sees committed state.
 */
async function lockTargetAndSuperadmins(
  tx: Prisma.TransactionClient,
  targetId: string,
): Promise<{ target: LockedUser | undefined; otherSuperadmins: LockedUser[] }> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "name", "role"::text AS "role", "telegramId", "mergedIntoUserId"
    FROM "User"
    WHERE "id" = ${targetId}
       OR ("role" = 'SUPERADMIN' AND "mergedIntoUserId" IS NULL AND "id" <> 'system')
    ORDER BY "id"
    FOR UPDATE
  `;
  return {
    target: rows.find((r) => r.id === targetId),
    otherSuperadmins: rows.filter(
      (r) =>
        r.id !== targetId &&
        r.id !== SYSTEM_USER_ID &&
        r.role === "SUPERADMIN" &&
        r.mergedIntoUserId === null,
    ),
  };
}

async function lockTarget(tx: Prisma.TransactionClient, targetId: string): Promise<LockedUser | undefined> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "name", "role"::text AS "role", "telegramId", "mergedIntoUserId"
    FROM "User"
    WHERE "id" = ${targetId}
    FOR UPDATE
  `;
  return rows[0];
}

function guardError(code: ExclusionGuardCode): DomainError {
  switch (code) {
    case "CANNOT_EXCLUDE_SELF":
      return new DomainError(code, USER_ERROR_MESSAGES.CANNOT_EXCLUDE_SELF, 400);
    case "LAST_SUPERADMIN":
      return new DomainError(code, USER_ERROR_MESSAGES.LAST_SUPERADMIN, 409);
    case "NOT_IN_TEAM":
      return new DomainError(code, USER_ERROR_MESSAGES.NOT_IN_TEAM, 409);
    case "ALREADY_EXCLUDED":
      return new DomainError(code, USER_ERROR_MESSAGES.ALREADY_EXCLUDED, 409);
  }
}

function guardMessage(code: ExclusionGuardCode): string {
  return guardError(code).message;
}

async function hasExclusionHistory(
  db: Prisma.TransactionClient | typeof prisma,
  targetId: string,
): Promise<boolean> {
  const prior = await db.auditLog.findFirst({
    where: { action: EXCLUDE_AUDIT_ACTION, entity: "User", entityId: targetId },
    select: { id: true },
  });
  return prior !== null;
}

// ─── Preview ────────────────────────────────────────────────────────────────

/** Data for the confirmation window (AC-A1.2); read-only, no locks. */
export async function getExclusionPreview(targetId: string, actorId: string): Promise<ExclusionPreview> {
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, role: true, telegramId: true, mergedIntoUserId: true },
  });
  if (!user) throw userNotFound();
  if (user.mergedIntoUserId) throw userMerged(user.mergedIntoUserId);

  const [grants, assignments, lists, prefs, openAssignedTasks] = await Promise.all([
    prisma.adminPermission.findMany({ where: { userId: targetId }, select: { section: true } }),
    prisma.moduleAssignment.findMany({
      where: { userId: targetId },
      select: { module: { select: { slug: true, name: true } } },
    }),
    prisma.moduleNotificationRecipient.findMany({
      where: { userId: targetId },
      select: { moduleSlug: true, module: { select: { name: true } } },
    }),
    prisma.notificationEventPreference.findMany({
      where: { userId: targetId, eventType: { in: MANAGED_TYPES } },
      select: { eventType: true },
    }),
    prisma.taskAssignee.count({
      where: {
        userId: targetId,
        role: { in: ["RESPONSIBLE", "COLLABORATOR"] },
        task: { closedAt: null, deletedAt: null },
      },
    }),
  ]);

  const explicit = grants.map((g) => g.section);
  const byRole = computeAdminSections(user.role, explicit).filter((s) => !explicit.includes(s));

  let guard: ExclusionGuardCode | null = null;
  if (targetId === actorId) {
    guard = "CANNOT_EXCLUDE_SELF";
  } else if (user.role === "USER") {
    guard = (await hasExclusionHistory(prisma, targetId)) ? "ALREADY_EXCLUDED" : "NOT_IN_TEAM";
  } else if (user.role === "SUPERADMIN") {
    const others = await prisma.user.count({
      where: {
        role: "SUPERADMIN",
        mergedIntoUserId: null,
        id: { notIn: [SYSTEM_USER_ID, targetId] },
      },
    });
    if (others === 0) guard = "LAST_SUPERADMIN";
  }

  return {
    user: { id: user.id, name: user.name, role: user.role },
    isSeededSuperadmin: isSeededSuperadmin(user),
    removes: {
      sectionsByRole: byRole.map(sectionLabel),
      explicitSections: explicit.map(sectionLabel),
      modules: assignments.map((a) => a.module.name),
      recipientLists: lists.map((l) => l.module.name),
      subscriptions: prefs.map((p) => eventLabel(p.eventType)),
    },
    counts: {
      sections: new Set([...byRole, ...explicit]).size,
      modules: assignments.length,
      recipientLists: lists.length,
      subscriptions: prefs.length,
    },
    openAssignedTasks,
    guard: guard ? { code: guard, message: guardMessage(guard) } : null,
  };
}

// ─── Exclusion ──────────────────────────────────────────────────────────────

/**
 * Exclude a team member: all-or-nothing (AC-A1.3), sessions revoked (AC-A1.5),
 * one AuditLog row with the removed lists and without contacts (AC-A1.9).
 */
export async function excludeFromTeam(
  targetId: string,
  actorId: string,
  opts: { confirmSeeded?: boolean; via: ExclusionVia },
): Promise<ExclusionResult> {
  if (targetId === actorId) throw guardError("CANNOT_EXCLUDE_SELF");

  const result = await prisma.$transaction(
    async (tx) => {
      const { target, otherSuperadmins } = await lockTargetAndSuperadmins(tx, targetId);
      if (!target) throw userNotFound();
      if (target.mergedIntoUserId) throw userMerged(target.mergedIntoUserId);

      // Concurrent / repeated exclusion lands here after the lock (AC-A1.8):
      // no second audit row, no changes.
      if (target.role === "USER") {
        throw guardError((await hasExclusionHistory(tx, targetId)) ? "ALREADY_EXCLUDED" : "NOT_IN_TEAM");
      }
      if (target.role === "SUPERADMIN" && otherSuperadmins.length === 0) {
        throw guardError("LAST_SUPERADMIN");
      }
      const seeded = isSeededSuperadmin(target);
      if (seeded && !opts.confirmSeeded) throw seededConfirmRequired();

      const grants = await tx.adminPermission.findMany({
        where: { userId: targetId },
        select: { section: true },
      });
      const assignments = await tx.moduleAssignment.findMany({
        where: { userId: targetId },
        select: { module: { select: { slug: true } } },
      });
      const lists = await tx.moduleNotificationRecipient.findMany({
        where: { userId: targetId },
        select: { moduleSlug: true },
      });
      const prefs = await tx.notificationEventPreference.findMany({
        where: { userId: targetId, eventType: { in: MANAGED_TYPES } },
        select: { eventType: true },
      });

      const removed: ExclusionRemoved = {
        sections: grants.map((g) => g.section),
        modules: assignments.map((a) => a.module.slug),
        recipientLists: lists.map((l) => l.moduleSlug),
        subscriptions: prefs.map((p) => p.eventType),
      };

      await tx.user.update({ where: { id: targetId }, data: { role: "USER" } });
      await bumpSessionVersion(tx, targetId);
      await tx.adminPermission.deleteMany({ where: { userId: targetId } });
      await tx.moduleAssignment.deleteMany({ where: { userId: targetId } });
      await tx.moduleNotificationRecipient.deleteMany({ where: { userId: targetId } });
      // Delete (not disable) catalog subscriptions: an explicit «off» row would
      // also mute the person's own client notifications of the same type (AC-A1.4).
      await tx.notificationEventPreference.deleteMany({
        where: { userId: targetId, eventType: { in: MANAGED_TYPES } },
      });
      // Mirror of the «Релизы» toggle; enable* (client notifications) untouched.
      await tx.notificationPreference.updateMany({
        where: { userId: targetId },
        data: { notifyReleases: false },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: EXCLUDE_AUDIT_ACTION,
          entity: "User",
          entityId: targetId,
          metadata: {
            previousRole: target.role,
            via: opts.via,
            removed: { ...removed },
            seededSuperadmin: seeded,
            confirmedSeeded: seeded && opts.confirmSeeded === true,
          },
        },
      });

      return removed;
    },
    { timeout: EXCLUSION_TX_TIMEOUT_MS },
  );

  await publishAuthState(targetId);

  return { userId: targetId, role: "USER", removed: result, sessionsRevoked: true };
}

// ─── Role change ────────────────────────────────────────────────────────────

/**
 * Change a user's role (US-A2):
 * - team → USER = exclusion (same guards and result as «Исключить из команды»);
 * - any demotion bumps the session version (AC-A2.2);
 * - promotion behaves as before (MANAGER gets «Дашборд», release subscription
 *   by default — AC-A2.4).
 * Every change writes `user.role.change` with old → new (AC-A2.5).
 */
export async function changeUserRole(
  targetId: string,
  newRole: Role,
  actorId: string,
  opts: { confirmSeeded?: boolean } = {},
): Promise<ChangeRoleResult> {
  const current = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true, mergedIntoUserId: true },
  });
  if (!current) throw userNotFound();
  if (current.mergedIntoUserId) throw userMerged(current.mergedIntoUserId);

  const oldRole = current.role;
  if (oldRole === newRole) return { kind: "unchanged", oldRole, newRole };

  const demotion = ROLE_RANK[newRole] < ROLE_RANK[oldRole];
  if (demotion && targetId === actorId) {
    throw new DomainError("CANNOT_DEMOTE_SELF", USER_ERROR_MESSAGES.CANNOT_DEMOTE_SELF, 400);
  }

  if (newRole === "USER") {
    const exclusion = await excludeFromTeam(targetId, actorId, {
      confirmSeeded: opts.confirmSeeded,
      via: "role_change",
    });
    return { kind: "excluded", oldRole, newRole: "USER", exclusion };
  }

  if (demotion) {
    await demote(targetId, oldRole, newRole, actorId, opts.confirmSeeded === true);
    return { kind: "demoted", oldRole, newRole, sessionsRevoked: true };
  }

  await promote(targetId, oldRole, newRole, actorId);
  return { kind: "promoted", oldRole, newRole };
}

function roleChangedConcurrently(): DomainError {
  return new DomainError(
    "ROLE_CHANGED_CONCURRENTLY",
    USER_ERROR_MESSAGES.ROLE_CHANGED_CONCURRENTLY,
    409,
  );
}

async function upsertDashboardGrant(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.adminPermission.upsert({
    where: { userId_section: { userId, section: "dashboard" } },
    create: { userId, section: "dashboard" },
    update: {},
  });
}

async function demote(
  targetId: string,
  oldRole: Role,
  newRole: Role,
  actorId: string,
  confirmSeeded: boolean,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const { target, otherSuperadmins } = await lockTargetAndSuperadmins(tx, targetId);
      if (!target) throw userNotFound();
      if (target.mergedIntoUserId) throw userMerged(target.mergedIntoUserId);
      if (target.role !== oldRole) throw roleChangedConcurrently();

      if (oldRole === "SUPERADMIN" && otherSuperadmins.length === 0) {
        throw new DomainError("LAST_SUPERADMIN", USER_ERROR_MESSAGES.LAST_SUPERADMIN_DEMOTE, 409);
      }
      const seeded = isSeededSuperadmin(target);
      if (seeded && !confirmSeeded) throw seededConfirmRequired();

      await tx.user.update({ where: { id: targetId }, data: { role: newRole } });
      await bumpSessionVersion(tx, targetId);
      // As before: a MANAGER always keeps the entry point to the admin panel.
      if (newRole === "MANAGER") await upsertDashboardGrant(tx, targetId);
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: ROLE_CHANGE_AUDIT_ACTION,
          entity: "User",
          entityId: targetId,
          metadata: {
            oldRole,
            newRole,
            demotion: true,
            ...(seeded ? { seededSuperadmin: true, confirmedSeeded: confirmSeeded } : {}),
          },
        },
      });
    },
    { timeout: EXCLUSION_TX_TIMEOUT_MS },
  );

  await publishAuthState(targetId);
}

async function promote(targetId: string, oldRole: Role, newRole: Role, actorId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const target = await lockTarget(tx, targetId);
      if (!target) throw userNotFound();
      if (target.mergedIntoUserId) throw userMerged(target.mergedIntoUserId);
      if (target.role !== oldRole) throw roleChangedConcurrently();

      await tx.user.update({ where: { id: targetId }, data: { role: newRole } });
      // Auto-assign «Дашборд» so a new manager can open the admin panel.
      if (newRole === "MANAGER") await upsertDashboardGrant(tx, targetId);
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: ROLE_CHANGE_AUDIT_ACTION,
          entity: "User",
          entityId: targetId,
          metadata: { oldRole, newRole },
        },
      });
    },
    { timeout: EXCLUSION_TX_TIMEOUT_MS },
  );

  // Promoting a non-staff (USER / ADMIN) account to MANAGER/SUPERADMIN subscribes
  // it to release notifications by default (idempotent, never clobbers an opt-out).
  const wasManagerOrSuperadmin = oldRole === "MANAGER" || oldRole === "SUPERADMIN";
  if ((newRole === "MANAGER" || newRole === "SUPERADMIN") && !wasManagerOrSuperadmin) {
    await ensureManagerNotifyDefaults(targetId);
  }
}
