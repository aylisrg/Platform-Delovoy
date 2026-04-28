import { NextRequest } from "next/server";
import { apiError, apiResponse, apiServerError } from "@/lib/api-response";
import { syncAllReviews } from "@/lib/avito";

export const dynamic = "force-dynamic";

/**
 * POST/GET /api/cron/avito-reviews-sync — sync Avito reviews for all active items.
 * Schedule: every hour.
 * Auth: ?token=<CRON_SECRET>.
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
    const token = request.nextUrl.searchParams.get("token");
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!token || token !== cronSecret) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

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
