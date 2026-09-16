import type { NextRequest } from "next/server";
import { apiResponse, apiValidationError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { productEventIngestSchema } from "@/modules/analytics/validation";
import { deriveSessionKeyFromHeaders, recordFunnelStepAsync } from "@/modules/analytics/product-events";

/**
 * POST /api/analytics/events — публичный ingest промежуточных шагов воронки
 * (US-1 эпика #583, ADR 2026-09-16 §6.1). Тело шлётся `navigator.sendBeacon`
 * из `@/lib/funnel-beacon`.
 *
 * Без auth (анонимные посетители). Защита от накрутки/PII:
 * - серверные шаги (submitted/paid) в схеме отсутствуют — подделать
 *   конверсию через этот эндпоинт нельзя;
 * - sessionKey всегда считается на сервере из заголовков запроса, клиент
 *   не может ни прислать его, ни выдать себя за другую сессию;
 * - `.strict()` в схеме — лишних полей, включая metadata, от клиента нет,
 *   PII физически некуда просочиться;
 * - rate limit 60/мин на доверенный IP + дедуп внутри recordFunnelStepAsync.
 */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, "product-event");
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = productEventIngestSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
  }

  const sessionKey = deriveSessionKeyFromHeaders(request.headers);
  await recordFunnelStepAsync({
    funnel: parsed.data.funnel,
    step: parsed.data.step,
    sessionKey,
  });

  return apiResponse({ accepted: true });
}
