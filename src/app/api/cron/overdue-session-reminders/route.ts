import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { scanAndDispatchOverdue } from "@/modules/booking/overdue-reminders";

// Cron route: GET to align with sibling cron endpoints
// (rental-payment-reminders, no-show, process-recurring all use GET).
// Auth: Bearer CRON_SECRET via timingSafeEqual.

function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length, 32);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  const equal = timingSafeEqual(aBuf, bBuf);
  return equal && a.length === b.length;
}

export async function GET(request: NextRequest) {
  // Feature flag — until WEB_PUSH_ENABLED=true and operators have subscribed,
  // we don't want a periodic cron generating dispatch attempts.
  if (process.env.WEB_PUSH_ENABLED !== "true") {
    return apiError(
      "WEB_PUSH_DISABLED",
      "Web Push channel is disabled — overdue cron is gated on WEB_PUSH_ENABLED",
      503
    );
  }

  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret) {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "CRON_SECRET is not configured",
      503
    );
  }

  const token =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!safeCompare(token, cronSecret)) {
    return apiError("UNAUTHORIZED", "Invalid cron token", 401);
  }

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
