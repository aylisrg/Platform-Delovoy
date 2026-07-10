import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { reconcilePayments } from "@/modules/payments/service";

function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length, 32);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

/**
 * GET /api/cron/payments-reconcile — добивание зависших платежей.
 * Вебхук-ретраи ЮKassa живут 24 часа; этот cron (каждые ~10 минут) сверяет
 * нефинальные платежи с провайдером и закрывает потерянные переходы.
 */
export async function GET(request: NextRequest) {
  try {
    const token =
      request.nextUrl.searchParams.get("token") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
    if (!cronSecret || !safeCompare(token, cronSecret)) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

    if (!isYooKassaConfigured()) {
      return apiResponse({ skipped: true, reason: "yookassa_not_configured" });
    }

    const report = await reconcilePayments();
    return apiResponse({ timestamp: new Date().toISOString(), report });
  } catch (err) {
    console.error("[Cron] Payments reconcile failed:", err);
    return apiServerError();
  }
}
