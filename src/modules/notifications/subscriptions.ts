import { prisma } from "@/lib/db";
import { EVENT_MODULE_CONTEXTS, MANAGED_EVENT_TYPES, categoryForEvent } from "./catalog";
import { contextAccess, type StaffSnapshot } from "./audience-rules";
import { loadStaffSnapshots } from "./audience";
import { NotificationDomainError } from "./errors";
import { RELEASE_EVENT_TYPE } from "./release-notify";

/**
 * The one write path for a staff member's subscription to a catalog event —
 * used by the staff page, the matrix and the Mini App Center alike
 * («админ ставит, сотрудник может менять», owner decision №3; AC-C2.2).
 * ADR 2026-10-25-team-access-notifications §5.2.
 */

export type SubscriptionVia = "admin" | "miniapp" | "matrix";

/** Access to the event in at least one module context (via the general or the list rule). */
export function hasEventAccess(snapshot: StaffSnapshot, eventType: string): boolean {
  const category = categoryForEvent(eventType);
  if (!category) return false;
  return (EVENT_MODULE_CONTEXTS[eventType] ?? [null]).some(
    (ctx) =>
      contextAccess(snapshot, category, ctx).ok ||
      (ctx !== null && snapshot.listModules.has(ctx) && contextAccess(snapshot, category, ctx, "module_list").ok),
  );
}

export async function setStaffEventSubscription(input: {
  targetUserId: string;
  eventType: string;
  enabled: boolean;
  actor: { userId: string; via: SubscriptionVia };
}): Promise<{ eventType: string; enabled: boolean; before: boolean | null }> {
  const { targetUserId, eventType, enabled, actor } = input;
  if (!(MANAGED_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new NotificationDomainError("UNKNOWN_EVENT", "Неизвестный тип уведомления", 422);
  }

  const [snapshot] = await loadStaffSnapshots({ userIds: [targetUserId] });
  if (!snapshot) throw new NotificationDomainError("USER_NOT_FOUND", "Пользователь не найден", 404);
  if (snapshot.role === "USER" || snapshot.merged) {
    throw new NotificationDomainError("NOT_IN_TEAM", "Пользователь не входит в команду", 422);
  }
  // Turning off is always allowed (even without access); turning on needs access.
  if (enabled && !hasEventAccess(snapshot, eventType)) {
    const label = categoryForEvent(eventType)?.label ?? eventType;
    throw new NotificationDomainError("NO_ACCESS_TO_CATEGORY", `Нет доступа к разделу «${label}»`, 422);
  }

  const before = snapshot.prefs.get(eventType)?.enabled ?? null;
  const actorFields = { updatedByUserId: actor.userId, updatedVia: actor.via };

  await prisma.$transaction(async (tx) => {
    await tx.notificationEventPreference.upsert({
      where: { userId_eventType: { userId: targetUserId, eventType } },
      create: { userId: targetUserId, eventType, enabled, ...actorFields },
      update: { enabled, ...actorFields },
    });
    if (eventType === RELEASE_EVENT_TYPE) {
      // Legacy mirror read by the team table — one write path, no drift (ADR 2026-08-13 §6.4).
      await tx.notificationPreference.upsert({
        where: { userId: targetUserId },
        create: { userId: targetUserId, notifyReleases: enabled },
        update: { notifyReleases: enabled },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "notification.preference.update",
        entity: "NotificationEventPreference",
        entityId: eventType,
        metadata: { targetUserId, eventType, before, after: enabled, via: actor.via },
      },
    });
  });

  return { eventType, enabled, before };
}
