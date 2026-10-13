import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { processRecurring } from "@/modules/management/service";
import { getCronBearerToken } from "@/lib/cron-auth";

/**
 * GET /api/cron/process-recurring — process due recurring expenses.
 *
 * Schedule: daily at 00:05 via system crontab or GitHub Actions.
 * Auth: Authorization: Bearer <CRON_SECRET> only (no ?token=, #1074).
 *
 * Example:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/process-recurring
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/process-recurring
 */
export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;

    const token = getCronBearerToken(request);

    if (!token || token !== cronSecret) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

    const result = await processRecurring();
    return apiResponse(result);
  } catch (err) {
    console.error("[cron/process-recurring] Job failed:", err);
    return apiServerError();
  }
}
