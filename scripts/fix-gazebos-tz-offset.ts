/**
 * One-off data correction for the gazebos timezone bug (see PR #369).
 *
 * BACKGROUND
 * ----------
 * Until #369, `gazebos` booking times were parsed with a timezone-naive
 * `new Date("YYYY-MM-DDTHH:mm:00")`. On the production server (TZ = UTC) a
 * guest picking 15:00 Moscow was stored as `15:00Z` instead of the correct
 * `12:00Z` — i.e. every existing gazebos booking sits +3h ahead of reality.
 * The code fix stops NEW bookings from drifting, but rows created BEFORE the
 * deploy still hold the wrong instant. This script shifts them back by -3h so
 * that `formatTime` (Europe/Moscow) renders the time the guest actually chose.
 *
 * SCOPE (intentionally narrow — do not widen without re-checking):
 *   - Only `moduleSlug = 'gazebos'`. ps-park always parsed with `+03:00` and is
 *     already correct — it is NOT touched.
 *   - Only rows created before CUTOFF (the fix-deploy timestamp), so bookings
 *     made by the fixed code are never shifted.
 *   - Rows already marked `metadata.tzCorrected = true` are skipped, so re-runs
 *     are safe (idempotent).
 *
 * SAFETY
 * ------
 * Dry-run is the DEFAULT: it prints every affected booking (Moscow time,
 * before -> after) and writes nothing. Review that list, then re-run with
 * APPLY=1 to persist. Take a DB backup first (scripts/pre-migration-backup.sh).
 *
 * USAGE
 * -----
 *   # 1. Dry run — inspect what WOULD change (nothing is written):
 *   CUTOFF="2026-07-24T00:00:00Z" npx tsx scripts/fix-gazebos-tz-offset.ts
 *
 *   # 2. Apply after reviewing the dry-run output:
 *   CUTOFF="2026-07-24T00:00:00Z" APPLY=1 npx tsx scripts/fix-gazebos-tz-offset.ts
 *
 * ENV:
 *   CUTOFF       (required) ISO timestamp of the fix deploy. Only bookings with
 *                createdAt < CUTOFF are candidates.
 *   APPLY=1      write changes. Omitted → dry run.
 *   SHIFT_HOURS  offset to subtract, default 3 (Europe/Moscow = UTC+3).
 */
import type { Prisma } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/db";
import { formatDateTime } from "../src/lib/format";

/**
 * Pure helper: shift both endpoints back by `shiftHours`. Extracted so the
 * arithmetic is unit-testable without touching the DB.
 */
export function shiftTimes(
  startTime: Date,
  endTime: Date,
  shiftHours: number
): { startTime: Date; endTime: Date } {
  const ms = shiftHours * 60 * 60 * 1000;
  return {
    startTime: new Date(startTime.getTime() - ms),
    endTime: new Date(endTime.getTime() - ms),
  };
}

async function main() {
  const apply = process.env.APPLY === "1";
  const shiftHours = Number(process.env.SHIFT_HOURS ?? "3");
  if (!Number.isFinite(shiftHours) || shiftHours <= 0) {
    throw new Error(`Invalid SHIFT_HOURS: ${process.env.SHIFT_HOURS}`);
  }

  const cutoffStr = process.env.CUTOFF;
  if (!cutoffStr) {
    throw new Error(
      "CUTOFF is required — pass the ISO timestamp of the fix deploy, e.g. " +
        'CUTOFF="2026-07-24T00:00:00Z". Aborting so no bookings are shifted blindly.'
    );
  }
  const cutoff = new Date(cutoffStr);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Invalid CUTOFF timestamp: "${cutoffStr}"`);
  }

  const candidates = await prisma.booking.findMany({
    where: { moduleSlug: "gazebos", createdAt: { lt: cutoff } },
    select: {
      id: true,
      clientName: true,
      status: true,
      startTime: true,
      endTime: true,
      metadata: true,
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  console.log(
    `gazebos bookings created before ${cutoff.toISOString()}: ${candidates.length}\n` +
      `mode: ${apply ? "APPLY (writing)" : "DRY RUN (nothing written)"} · shift: -${shiftHours}h\n` +
      "id | client | status | Moscow before -> after"
  );

  let willShift = 0;
  let skipped = 0;
  for (const b of candidates) {
    const meta = (b.metadata as Record<string, unknown> | null) ?? {};
    if (meta.tzCorrected === true) {
      skipped++;
      continue;
    }
    willShift++;
    const next = shiftTimes(b.startTime, b.endTime, shiftHours);
    console.log(
      `${b.id} | ${b.clientName ?? "—"} | ${b.status} | ` +
        `${formatDateTime(b.startTime)}–${formatDateTime(b.endTime)} -> ` +
        `${formatDateTime(next.startTime)}–${formatDateTime(next.endTime)}`
    );
    if (apply) {
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          startTime: next.startTime,
          endTime: next.endTime,
          metadata: {
            ...meta,
            tzCorrected: true,
            tzCorrectedShiftHours: -shiftHours,
            tzCorrectedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  console.log(
    `\nDone. candidates=${candidates.length} already-corrected=${skipped} ` +
      `${apply ? `shifted=${willShift}` : `would-shift=${willShift} (set APPLY=1 to write)`}`
  );
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
