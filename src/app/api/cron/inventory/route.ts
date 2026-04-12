import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { getExpiringBatches } from "@/modules/inventory/service-v2";
import { runLowStockAlertSweep } from "@/modules/inventory/alerts";
import { prisma } from "@/lib/db";

/**
 * GET /api/cron/inventory — run inventory background jobs.
 *
 * Schedule: every 15 minutes via system cron or GitHub Actions.
 * Example:
 *   curl "http://localhost:3000/api/cron/inventory?token=<CRON_SECRET>"
 *
 * Jobs:
 * 1. Flag expired batches and send Telegram alert to manager
 * 2. Sweep all SKUs for low-stock alerts (with Redis dedup)
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;

    if (!token || token !== cronSecret) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

    const results: {
      expiredBatches: number;
      lowStockAlerts: { checked: number; alerted: number };
    } = {
      expiredBatches: 0,
      lowStockAlerts: { checked: 0, alerted: 0 },
    };

    // 1. Check for expired batches and log them as SystemEvents
    const expiring = await getExpiringBatches(0); // 0 days = already expired
    const trueExpired = expiring.filter((b) => b.daysUntilExpiry <= 0);
    results.expiredBatches = trueExpired.length;

    if (trueExpired.length > 0) {
      await prisma.systemEvent.create({
        data: {
          level: "WARNING",
          source: "cron/inventory",
          message: `${trueExpired.length} партий с истёкшим сроком годности ожидают списания`,
          metadata: {
            batches: trueExpired.map((b) => ({
              batchId: b.batchId,
              sku: b.skuName,
              qty: b.remainingQty,
              expiresAt: b.expiresAt,
            })),
          },
        },
      });
    }

    // 2. Low stock alert sweep
    results.lowStockAlerts = await runLowStockAlertSweep();

    return apiResponse({
      ok: true,
      ranAt: new Date().toISOString(),
      ...results,
    });
  } catch (err) {
    console.error("[cron/inventory] Job failed:", err);
    return apiServerError();
  }
}
