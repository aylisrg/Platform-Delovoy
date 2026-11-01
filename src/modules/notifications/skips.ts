import { prisma } from "@/lib/db";
import { MANAGED_EVENT_TYPES } from "./catalog";

/**
 * Delivery skips — the notification was never attempted (AC-D4.3): answers
 * «почему мне не пришло» for staff (catalog) event types only.
 * ADR 2026-10-25-team-access-notifications §Q3. Best effort, never throws.
 */
export type SkipReason = "DUPLICATE" | "PREFERENCE_DISABLED" | "OPTED_OUT" | "DND" | "NO_CHANNEL";

export type SkipInput = {
  userId: string;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  reason: SkipReason;
};

const MANAGED = new Set<string>(MANAGED_EVENT_TYPES);

function toRow(input: SkipInput) {
  return {
    userId: input.userId,
    eventType: input.eventType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    reason: input.reason,
  };
}

export async function recordSkip(input: SkipInput): Promise<void> {
  if (!MANAGED.has(input.eventType)) return;
  try {
    await prisma.notificationDeliverySkip.create({ data: toRow(input) });
  } catch (err) {
    console.warn("[skips] record failed:", err instanceof Error ? err.message : err);
  }
}

export async function recordSkips(inputs: SkipInput[]): Promise<void> {
  const rows = inputs.filter((i) => MANAGED.has(i.eventType)).map(toRow);
  if (rows.length === 0) return;
  try {
    await prisma.notificationDeliverySkip.createMany({ data: rows });
  } catch (err) {
    console.warn("[skips] record failed:", err instanceof Error ? err.message : err);
  }
}
