import { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { processRecurring } from "@/modules/management/service";

/**
 * GET /api/cron/process-recurring — process due recurring expenses.
 *
 * Schedule: daily at 00:05 via system crontab or GitHub Actions.
 * Auth: Authorization: Bearer <CRON_SECRET> (src/lib/cron-auth.ts).
 *
 * Example:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/process-recurring
 *   curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/process-recurring"
 */
export async function GET(request: NextRequest) {
  try {
    const denied = verifyCronRequest(request);
    if (denied) return denied;

    const result = await processRecurring();
    return apiResponse(result);
  } catch (err) {
    console.error("[cron/process-recurring] Job failed:", err);
    return apiServerError();
  }
}
