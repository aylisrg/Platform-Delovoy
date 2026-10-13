import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { reconcilePayments } from "@/modules/payments/service";
import { verifyCronRequest } from "@/lib/cron-auth";


/**
 * GET /api/cron/payments-reconcile — добивание зависших платежей.
 * Вебхук-ретраи ЮKassa живут 24 часа; этот cron (каждые ~10 минут) сверяет
 * нефинальные платежи с провайдером и закрывает потерянные переходы.
 */
export async function GET(request: NextRequest) {
  try {
    const denied = verifyCronRequest(request);
    if (denied) return denied;

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
