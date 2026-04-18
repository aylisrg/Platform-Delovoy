import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { processRecurring } from "@/modules/management/service";

/**
 * GET /api/cron/process-recurring — process due recurring expenses.
 *
 * Schedule: daily at 00:05 via system crontab or GitHub Actions.
 * Auth: Bearer token (CRON_SECRET) or query param ?token=.
 *
 * Example:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/process-recurring
 *   curl "http://localhost:3000/api/cron/process-recurring?token=$CRON_SECRET"
 */
export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;

    // Support both Bearer token and query param (consistent with other cron endpoints)
    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const queryToken = request.nextUrl.searchParams.get("token");
    const token = bearerToken ?? queryToken;

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
