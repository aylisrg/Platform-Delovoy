import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { verifyCronRequest } from "@/lib/cron-auth";
import { NovofonApiError, syncNovofonCalls } from "@/modules/telephony/calls-sync";

/**
 * GET /api/cron/novofon-calls-sync — журнал звонков из Novofon (#1066 PR1).
 * Первый запуск — бэкфилл 90 дней, дальше инкремент каждые 10 минут.
 */
export async function GET(request: NextRequest) {
  try {
    const denied = verifyCronRequest(request, { route: "novofon-calls-sync" });
    if (denied) return denied;

    const result = await syncNovofonCalls();
    return apiResponse({ timestamp: new Date().toISOString(), ...result });
  } catch (err) {
    // Только код ошибки, без тела ответа и номеров.
    const code = err instanceof NovofonApiError ? err.code : "internal";
    console.error(`[Cron] novofon-calls-sync failed: code=${code}`);
    return apiServerError();
  }
}
