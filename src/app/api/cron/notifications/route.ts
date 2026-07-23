import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { processScheduledNotifications } from "@/modules/notifications/scheduler";
import { log } from "@/lib/logger";

function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length, 32);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

/**
 * GET /api/cron/notifications — напоминания о бронях + алерты об истечении
 * договоров. Регистрируется в crontab VPS деплоем (deploy.yml), каждые 5 минут.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (предпочтительно — секрет не
 * попадает в access-логи nginx) или ?token= для обратной совместимости.
 * Фолбэк на NEXTAUTH_SECRET убран: секрет аутентификации не должен
 * использоваться в cron-URL.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret) {
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }

  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("token") ??
    "";
  if (!safeCompare(token, cronSecret)) {
    return apiError("UNAUTHORIZED", "Invalid cron token", 401);
  }

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
