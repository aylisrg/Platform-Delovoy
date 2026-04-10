import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { processScheduledNotifications } from "@/modules/notifications/scheduler";

/**
 * GET /api/cron/notifications — trigger scheduled notification processing.
 *
 * Call this endpoint periodically (e.g., every 5 minutes) via cron:
 *   curl http://localhost:3000/api/cron/notifications?token=<CRON_SECRET>
 *
 * Or via Vercel Cron / external cron service.
 */
export async function GET(request: NextRequest) {
  try {
    // Simple token-based auth for cron
    const token = request.nextUrl.searchParams.get("token");
    const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

    if (token !== cronSecret) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

    await processScheduledNotifications();

    return apiResponse({ processed: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[Cron] Notification processing error:", error);
    return apiServerError();
  }
}
