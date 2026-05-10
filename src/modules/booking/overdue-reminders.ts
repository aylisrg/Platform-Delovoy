// Single-source overdue session scanner for ps-park + gazebos.
// Lives in shared booking module — see ADR
// docs/architecture/2026-05-10-overdue-session-reminders-adr.md §3.
//
// PR 4/4 of the overdue-session-reminders feature: cron-driven scan of
// CHECKED_IN / CONFIRMED bookings whose endTime has passed. For each
// overdue booking we choose an event slot (first reminder / repeat /
// superadmin escalation) and dispatch through NotificationDispatcher.
// Per-recipient dedup is handled by the dispatcher's existing dedupKey
// mechanism (5-minute window) — different eventType per slot ensures
// the next escalation step still passes dedup.

import { z } from "zod";
import { prisma } from "@/lib/db";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import type { NotificationPayload } from "@/modules/notifications/dispatch/types";

export const OVERDUE_MODULE_SLUGS = ["ps-park", "gazebos"] as const;
export type OverdueModuleSlug = (typeof OVERDUE_MODULE_SLUGS)[number];

export const DEFAULT_OVERDUE_THRESHOLDS = {
  /** Send first reminder when endTime older than this. */
  firstReminderMinutes: 5,
  /** Send a repeat to the manager when endTime older than this. */
  repeatReminderMinutes: 15,
  /** Escalate to SUPERADMIN(s) when endTime older than this. */
  escalateToSuperadminMinutes: 30,
} as const;

export type OverdueThresholds = {
  firstReminderMinutes: number;
  repeatReminderMinutes: number;
  escalateToSuperadminMinutes: number;
};

export const EVENT_TYPES = {
  first: "session.overdue.reminder",
  repeat: "session.overdue.escalation.manager",
  escalated: "session.overdue.escalation.superadmin",
} as const;

const overdueThresholdsSchema = z
  .object({
    firstReminderMinutes: z.number().int().min(1).max(360),
    repeatReminderMinutes: z.number().int().min(1).max(720),
    escalateToSuperadminMinutes: z.number().int().min(1).max(1440),
  })
  .partial();

export type OverdueBooking = {
  bookingId: string;
  moduleSlug: OverdueModuleSlug;
  endTime: Date;
  ageMinutes: number;
  status: "CHECKED_IN" | "CONFIRMED";
  resourceId: string;
};

type ScanOptions = {
  /** Per-module override of thresholds (already merged with defaults). */
  thresholds?: Partial<OverdueThresholds>;
};

type ScanResult = {
  scanned: number;
  dispatched: number;
  escalated: number;
  deduped: number;
  skippedNoChannel: number;
};

/**
 * Read effective thresholds for a module slug. Reads `Module.config.overdueThresholds`
 * from the DB; falls back to defaults on missing/invalid config and emits a WARNING.
 * Also returns whether the module is active (so caller can skip it cleanly).
 */
export async function loadModuleConfig(slug: OverdueModuleSlug): Promise<{
  isActive: boolean;
  thresholds: OverdueThresholds;
}> {
  const moduleRow = await prisma.module.findUnique({ where: { slug } });
  if (!moduleRow) {
    return { isActive: false, thresholds: { ...DEFAULT_OVERDUE_THRESHOLDS } };
  }
  const raw =
    (moduleRow.config as { overdueThresholds?: unknown } | null)?.overdueThresholds ??
    null;
  if (raw == null) {
    return {
      isActive: moduleRow.isActive,
      thresholds: { ...DEFAULT_OVERDUE_THRESHOLDS },
    };
  }
  const parsed = overdueThresholdsSchema.safeParse(raw);
  if (!parsed.success) {
    await prisma.systemEvent.create({
      data: {
        level: "WARNING",
        source: "scheduler",
        message: `Invalid overdueThresholds in Module(${slug}).config — fallback to defaults`,
        metadata: { slug, errors: parsed.error.flatten() },
      },
    });
    return {
      isActive: moduleRow.isActive,
      thresholds: { ...DEFAULT_OVERDUE_THRESHOLDS },
    };
  }
  return {
    isActive: moduleRow.isActive,
    thresholds: { ...DEFAULT_OVERDUE_THRESHOLDS, ...parsed.data },
  };
}

/**
 * Returns CHECKED_IN/CONFIRMED bookings for `slug` whose endTime is older
 * than (now − firstReminderMinutes). Soft-deleted rows are excluded.
 */
export async function findOverdueBookings(
  now: Date,
  slug: OverdueModuleSlug,
  thresholds: OverdueThresholds
): Promise<OverdueBooking[]> {
  const cutoff = new Date(now.getTime() - thresholds.firstReminderMinutes * 60_000);
  const rows = await prisma.booking.findMany({
    where: {
      moduleSlug: slug,
      status: { in: ["CHECKED_IN", "CONFIRMED"] },
      endTime: { lt: cutoff },
      deletedAt: null,
    },
    select: {
      id: true,
      moduleSlug: true,
      endTime: true,
      status: true,
      resourceId: true,
    },
  });

  return rows.map((b) => ({
    bookingId: b.id,
    moduleSlug: slug,
    endTime: b.endTime,
    ageMinutes: Math.floor((now.getTime() - b.endTime.getTime()) / 60_000),
    status: b.status as "CHECKED_IN" | "CONFIRMED",
    resourceId: b.resourceId,
  }));
}

function pickEventType(
  ageMinutes: number,
  th: OverdueThresholds
): "first" | "repeat" | "escalated" | null {
  if (ageMinutes >= th.escalateToSuperadminMinutes) return "escalated";
  if (ageMinutes >= th.repeatReminderMinutes) return "repeat";
  if (ageMinutes >= th.firstReminderMinutes) return "first";
  return null;
}

function buildPayload(
  booking: OverdueBooking,
  slot: "first" | "repeat" | "escalated",
  resourceName: string | null,
  managerNames: string[],
): NotificationPayload {
  const moduleLabel = booking.moduleSlug === "ps-park" ? "PS Park" : "Беседка";
  const resourceLabel = resourceName ? `${moduleLabel} «${resourceName}»` : moduleLabel;
  const titlePrefix =
    slot === "escalated"
      ? "Эскалация"
      : slot === "repeat"
        ? "Повторное напоминание"
        : "Просрочена сессия";
  // PRD AC-3.2: при эскалации SUPERADMIN получает имя менеджера(ов) модуля.
  const managerSuffix =
    slot === "escalated" && managerNames.length > 0
      ? ` Менеджер: ${managerNames.join(", ")}.`
      : "";
  return {
    title: `${titlePrefix}: ${resourceLabel}`,
    body: `Сессия ${booking.bookingId.slice(0, 8)} просрочена на ${booking.ageMinutes} мин — закройте или продлите.${managerSuffix}`,
    actions: [
      {
        label: "Открыть",
        url: `/admin/${booking.moduleSlug}/bookings/${booking.bookingId}`,
      },
    ],
    metadata: {
      bookingId: booking.bookingId,
      moduleSlug: booking.moduleSlug,
      resourceId: booking.resourceId,
      resourceName,
      ageMinutes: booking.ageMinutes,
      tag: `overdue:${booking.bookingId}`,
      ...(slot === "escalated" && { managerNames }),
    },
  };
}

async function getResourceName(resourceId: string | null): Promise<string | null> {
  if (!resourceId) return null;
  const row = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { name: true },
  });
  return row?.name ?? null;
}

async function getUserNames(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { name: true },
  });
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

async function getModuleManagers(moduleSlug: OverdueModuleSlug): Promise<string[]> {
  const moduleRow = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { id: true },
  });
  if (!moduleRow) return [];
  const assignments = await prisma.moduleAssignment.findMany({
    where: { moduleId: moduleRow.id, user: { role: "MANAGER" } },
    select: { userId: true },
  });
  return assignments.map((a) => a.userId);
}

async function getSuperadmins(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * For one booking, pick the appropriate event slot and fire dispatch for each
 * recipient. Returns counters merged into the global scan result.
 */
async function processBooking(
  booking: OverdueBooking,
  thresholds: OverdueThresholds
): Promise<{
  dispatched: number;
  escalated: number;
  deduped: number;
  skippedNoChannel: number;
  hadRecipients: boolean;
}> {
  const slot = pickEventType(booking.ageMinutes, thresholds);
  if (!slot) {
    return {
      dispatched: 0,
      escalated: 0,
      deduped: 0,
      skippedNoChannel: 0,
      hadRecipients: true,
    };
  }
  const eventType = EVENT_TYPES[slot];

  const managerIds = await getModuleManagers(booking.moduleSlug);
  const recipients =
    slot === "escalated" ? [...managerIds, ...(await getSuperadmins())] : managerIds;
  const uniqueRecipients = Array.from(new Set(recipients));

  // Enrich payload — resource name (AC-1.5) и manager names при эскалации (AC-3.2).
  const resourceName = await getResourceName(booking.resourceId);
  const managerNames = slot === "escalated" ? await getUserNames(managerIds) : [];
  const payload = buildPayload(booking, slot, resourceName, managerNames);

  if (uniqueRecipients.length === 0) {
    await prisma.systemEvent.create({
      data: {
        level: "WARNING",
        source: "scheduler",
        message: `Overdue booking ${booking.bookingId} has no recipients (no managers/superadmins for ${booking.moduleSlug})`,
        metadata: { bookingId: booking.bookingId, moduleSlug: booking.moduleSlug, slot },
      },
    });
    return {
      dispatched: 0,
      escalated: 0,
      deduped: 0,
      skippedNoChannel: 0,
      hadRecipients: false,
    };
  }

  let dispatched = 0;
  let deduped = 0;
  let skippedNoChannel = 0;

  for (const userId of uniqueRecipients) {
    const outcome = await dispatch({
      userId,
      eventType,
      entityType: "Booking",
      entityId: booking.bookingId,
      payload,
    });

    if (outcome.status === "queued" || outcome.status === "deferred") {
      dispatched++;
      // AuditLog: each successful enqueue is a system-driven mutation.
      await prisma.auditLog.create({
        data: {
          userId,
          action: "notification.overdue.dispatched",
          entity: "Booking",
          entityId: booking.bookingId,
          metadata: {
            eventType,
            moduleSlug: booking.moduleSlug,
            ageMinutes: booking.ageMinutes,
            outcome: outcome.status,
          },
        },
      });
    } else if (outcome.status === "skipped") {
      if (outcome.reason === "duplicate") {
        deduped++;
      } else if (outcome.reason === "no available channel") {
        skippedNoChannel++;
        await prisma.systemEvent.create({
          data: {
            level: "WARNING",
            source: "scheduler",
            message: `Overdue reminder skipped: user ${userId} has no available notification channel`,
            metadata: {
              userId,
              bookingId: booking.bookingId,
              moduleSlug: booking.moduleSlug,
              eventType,
            },
          },
        });
      }
      // Other skip reasons (preference disabled, DND) are not error states.
    }
  }

  if (slot === "escalated" && dispatched > 0) {
    await prisma.systemEvent.create({
      data: {
        level: "WARNING",
        source: "scheduler",
        message: `Booking ${booking.bookingId} escalated to SUPERADMIN — overdue ${booking.ageMinutes}min`,
        metadata: {
          bookingId: booking.bookingId,
          moduleSlug: booking.moduleSlug,
          ageMinutes: booking.ageMinutes,
        },
      },
    });
  }

  return {
    dispatched,
    escalated: slot === "escalated" ? dispatched : 0,
    deduped,
    skippedNoChannel,
    hadRecipients: true,
  };
}

/**
 * Top-level entry point used by the cron route.
 * Scans both ps-park and gazebos for overdue bookings and dispatches
 * notifications according to the slot (first / repeat / escalated).
 */
export async function scanAndDispatchOverdue(
  now: Date = new Date(),
  options: ScanOptions = {}
): Promise<ScanResult> {
  let scanned = 0;
  let dispatched = 0;
  let escalated = 0;
  let deduped = 0;
  let skippedNoChannel = 0;

  for (const slug of OVERDUE_MODULE_SLUGS) {
    const { isActive, thresholds: cfgThresholds } = await loadModuleConfig(slug);
    if (!isActive) continue;

    const thresholds: OverdueThresholds = {
      ...cfgThresholds,
      ...(options.thresholds ?? {}),
    };

    const overdue = await findOverdueBookings(now, slug, thresholds);
    scanned += overdue.length;

    for (const booking of overdue) {
      const r = await processBooking(booking, thresholds);
      dispatched += r.dispatched;
      escalated += r.escalated;
      deduped += r.deduped;
      skippedNoChannel += r.skippedNoChannel;
    }
  }

  return { scanned, dispatched, escalated, deduped, skippedNoChannel };
}
