import { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { scanAndDispatchOverdue } from "@/modules/booking/overdue-reminders";

// Cron route: GET to align with sibling cron endpoints
// (rental-payment-reminders, no-show, process-recurring all use GET).
// Auth: Bearer CRON_SECRET via timingSafeEqual.


export async function GET(request: NextRequest) {
  // Cron работает независимо от WEB_PUSH_ENABLED:
  // NotificationDispatcher выбирает канал per-user (Telegram → Web Push → Email).
  // Если у менеджера привязан Telegram — он получит напоминание даже когда
  // Web Push выключен. См. PR-4 review feedback (PRD: «Primary: Telegram-бот»).
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  // Defence-in-depth: trip rate limiter before doing real work, so an
  // accidental crontab misfire (every-minute) doesn't hammer the dispatcher.
  const rateLimited = await rateLimit(request, "public");
  if (rateLimited) return rateLimited;

  try {
    const result = await scanAndDispatchOverdue(new Date());
    return apiResponse({
      processedAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    console.error("[Cron] overdue-session-reminders failed:", err);
    return apiServerError();
  }
}
