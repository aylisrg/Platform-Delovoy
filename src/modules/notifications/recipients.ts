import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Module recipient lists — `ModuleNotificationRecipient` rows (was the JSON
 * `Module.config.notificationRecipients`; ADR 2026-10-25-team-access-notifications §Q2).
 * Delivery reads them through the resolver (`audience.ts`), which re-checks
 * role and access on every send; this file only manages the list.
 */

export type RecipientInfo = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  hasTelegramChannel: boolean;
  isSelected: boolean;
};

/** Raw list for a module (who is on it, regardless of current access). */
export async function getExplicitRecipientUserIds(moduleSlug: string): Promise<string[]> {
  const rows = await prisma.moduleNotificationRecipient.findMany({
    where: { moduleSlug },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.userId);
}

/**
 * Replace a module's recipient list. Admitted: SUPERADMIN, ADMIN, MANAGER
 * assigned to the module (non-merged); everything else is dropped silently.
 * Audited with before/after when an actor is given.
 */
export async function setRecipientUserIds(
  moduleSlug: string,
  userIds: string[],
  actorId?: string,
): Promise<string[]> {
  const mod = await prisma.module.findUnique({ where: { slug: moduleSlug }, select: { id: true } });
  if (!mod) throw new Error("MODULE_NOT_FOUND");

  let validIds: string[] = [];
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        id: { in: [...new Set(userIds)] },
        mergedIntoUserId: null,
        role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] as Role[] },
      },
      select: { id: true, role: true, moduleAssignments: { where: { moduleId: mod.id }, select: { id: true } } },
    });
    validIds = users
      .filter((u) => u.role !== "MANAGER" || u.moduleAssignments.length > 0)
      .map((u) => u.id);
  }

  const before = await getExplicitRecipientUserIds(moduleSlug);
  await prisma.$transaction(async (tx) => {
    await tx.moduleNotificationRecipient.deleteMany({ where: { moduleSlug } });
    if (validIds.length > 0) {
      await tx.moduleNotificationRecipient.createMany({
        data: validIds.map((userId) => ({ moduleSlug, userId, createdByUserId: actorId ?? null })),
        skipDuplicates: true,
      });
    }
    if (actorId) {
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "notification.recipients.update",
          entity: "Module",
          entityId: moduleSlug,
          metadata: { moduleSlug, before, after: validIds },
        },
      });
    }
  });
  return validIds;
}

/**
 * Users eligible for a module's list: SUPERADMINs, ADMINs and MANAGERs
 * assigned to the module. `isSelected` is the real membership — SUPERADMINs
 * included (they no longer «always receive», AC-C3.3).
 */
export async function listEligibleRecipients(moduleSlug: string): Promise<RecipientInfo[]> {
  const mod = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { assignments: { select: { userId: true } } },
  });
  const assignedIds = (mod?.assignments ?? []).map((a) => a.userId);
  const selected = new Set(await getExplicitRecipientUserIds(moduleSlug));

  const users = await prisma.user.findMany({
    where: {
      mergedIntoUserId: null,
      OR: [{ role: { in: ["SUPERADMIN", "ADMIN"] as Role[] } }, { role: "MANAGER", id: { in: assignedIds } }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      notificationChannels: {
        where: { kind: "TELEGRAM", isActive: true },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    hasTelegramChannel: u.notificationChannels.length > 0,
    isSelected: selected.has(u.id),
  }));
}
