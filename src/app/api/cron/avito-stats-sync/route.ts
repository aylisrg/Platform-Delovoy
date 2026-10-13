import { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { refreshItemSnapshot } from "@/lib/avito";

export const dynamic = "force-dynamic";

/**
 * POST/GET /api/cron/avito-stats-sync — refresh AvitoItemStatsSnapshot for all
 * ACTIVE items, both 7d and 30d periods.
 * Schedule: every 15 minutes.
 * Auth:  (matches existing /api/cron/inventory pattern).
 * Gated by AVITO_CRON_ENABLED=true.
 */
export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}

async function run(request: NextRequest) {
  try {
    const denied = verifyCronRequest(request);
    if (denied) return denied;

    if (process.env.AVITO_CRON_ENABLED !== "true") {
      return apiResponse({ skipped: true, reason: "AVITO_CRON_ENABLED is not set to 'true'" });
    }

    const items = await prisma.avitoItem.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, avitoItemId: true },
    });

    let ok = 0;
    let failed = 0;
    for (const item of items) {
      for (const period of ["7d", "30d"] as const) {
        try {
          await refreshItemSnapshot(item.id, item.avitoItemId, period);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
    }

    return apiResponse({ items: items.length, snapshotsOk: ok, snapshotsFailed: failed });
  } catch (err) {
    console.error("[cron avito-stats-sync] error", err);
    return apiServerError();
  }
}
