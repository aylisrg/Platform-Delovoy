import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { syncAllReviews } from "@/lib/avito";
import { verifyLegacyCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * POST/GET /api/cron/avito-reviews-sync — sync Avito reviews for all active items.
 * Schedule: every hour.
 * Auth: Authorization: Bearer <CRON_SECRET>.
 * Gated by AVITO_CRON_ENABLED=true.
 *
 * Triggers Telegram alert (`avito.review.negative`) for new reviews with rating <= 3
 * and updates denormalised AvitoItem.avgRating / reviewsCount.
 */
export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}

async function run(request: NextRequest) {
  try {
    const denied = verifyLegacyCronRequest(request, "avito-reviews-sync");
    if (denied) return denied;

    if (process.env.AVITO_CRON_ENABLED !== "true") {
      return apiResponse({
        skipped: true,
        reason: "AVITO_CRON_ENABLED is not set to 'true'",
      });
    }

    const result = await syncAllReviews();
    return apiResponse(result);
  } catch (err) {
    console.error("[cron avito-reviews-sync] error", err);
    return apiServerError();
  }
}
