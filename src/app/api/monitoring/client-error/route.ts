import type { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { clientErrorSchema } from "@/modules/monitoring/validation";
import { logClientError } from "@/modules/monitoring/service";

/**
 * POST /api/monitoring/client-error — публичный error-beacon.
 *
 * Браузер шлёт сюда необработанные ошибки (см. src/components/ClientErrorBeacon.tsx),
 * они попадают в SystemEvent (WARNING, source "client-beacon") и видны в
 * админ-мониторинге. Введён по инциденту 2026-07-20: клиентские причины
 * «вечной загрузки» (SW-кэш, стейл-чанки) были невидимы серверным пробам.
 *
 * Без auth (ошибки случаются и у анонимов). Защита: rate limit 10/мин/IP,
 * жёсткие лимиты длин в Zod-схеме, полезная нагрузка не интерпретируется.
 */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, "client-error");
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = clientErrorSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
  }

  try {
    await logClientError(parsed.data);
    return apiResponse({ accepted: true });
  } catch {
    // Бикон не должен становиться источником шума при проблемах с БД.
    return apiServerError("Не удалось сохранить событие");
  }
}
