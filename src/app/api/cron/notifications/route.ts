import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { processScheduledNotifications } from "@/modules/notifications/scheduler";
import { log } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";


/**
 * GET /api/cron/notifications — напоминания о бронях + алерты об истечении
 * договоров. Регистрируется в crontab VPS деплоем (deploy.yml), каждые 5 минут.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (предпочтительно — секрет не
 * попадает в access-логи nginx). Query ?token= не принимается (#1074).
 * Фолбэк на NEXTAUTH_SECRET убран: секрет аутентификации не должен
 * использоваться в cron-URL.
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
