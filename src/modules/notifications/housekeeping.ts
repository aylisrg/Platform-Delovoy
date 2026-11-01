import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";

/**
 * Daily retention for tracking data (ADR 2026-10-25-team-access-notifications §Q3):
 * - NotificationLink: 400 days (buttons keep working ≥ 12 months, AC-D3.8),
 *   then removed → the redirect falls back to the home page;
 * - NotificationDeliverySkip: 180 days.
 * Runs from the 5-minute scheduler but at most once a day (Redis NX key);
 * deletes in batches so one run never holds a long lock.
 */
export const SKIP_RETENTION_DAYS = 180;
const BATCH = 5000;
const MAX_BATCHES = 20;

function dayKey(now: Date): string {
  return `notif:housekeeping:${now.toISOString().slice(0, 10)}`;
}

async function deleteInBatches(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const deleted = await run();
    total += deleted;
    if (deleted < BATCH) break;
  }
  return total;
}

export async function runNotificationHousekeeping(
  now: Date = new Date(),
): Promise<{ ran: boolean; links: number; skips: number }> {
  // Without Redis we can't coordinate «once a day» across replicas → skip;
  // retention is not urgent.
  if (!redisAvailable) return { ran: false, links: 0, skips: 0 };
  const claimed = await redis.set(dayKey(now), "1", "EX", 90_000, "NX").catch(() => null);
  if (claimed !== "OK") return { ran: false, links: 0, skips: 0 };

  const skipCutoff = new Date(now.getTime() - SKIP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const links = await deleteInBatches(() =>
    prisma.$executeRaw`
      DELETE FROM "NotificationLink" WHERE "id" IN (
        SELECT "id" FROM "NotificationLink" WHERE "expiresAt" < ${now} LIMIT ${BATCH}
      )`,
  );
  const skips = await deleteInBatches(() =>
    prisma.$executeRaw`
      DELETE FROM "NotificationDeliverySkip" WHERE "id" IN (
        SELECT "id" FROM "NotificationDeliverySkip" WHERE "createdAt" < ${skipCutoff} LIMIT ${BATCH}
      )`,
  );
  return { ran: true, links, skips };
}
