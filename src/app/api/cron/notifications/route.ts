import { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { processScheduledNotifications } from "@/modules/notifications/scheduler";
import { log } from "@/lib/logger";


/**
 * GET /api/cron/notifications — напоминания о бронях + алерты об истечении
 * договоров. Регистрируется в crontab VPS деплоем (deploy.yml), каждые 5 минут.
 *
 * Auth: только Authorization: Bearer <CRON_SECRET>, см. src/lib/cron-auth.ts.
 */
export async function GET(request: NextRequest) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  try {
    await processScheduledNotifications();
    void log.info("cron.notifications", "Scheduled notifications processed");
    return apiResponse({ processed: true, processedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[Cron] Notification processing error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    void log.error("cron.notifications", `Scheduled batch failed: ${msg}`);
    return apiServerError();
  }
}
