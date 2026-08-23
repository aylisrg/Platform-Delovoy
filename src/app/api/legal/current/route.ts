import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { DOCUMENT_KEYS, getCurrentVersion } from "@/modules/booking/offer";

/**
 * GET /api/legal/current — действующая редакция публичной оферты.
 *
 * Форма бронирования должна знать номер редакции, которую показывает клиенту:
 * этот slug уезжает обратно вместе с акцептом, и сервер сверяет, что клиент
 * согласился именно с действующим текстом.
 *
 * Отдаём только метаданные — сам текст живёт на /oferta, отдельной страницей,
 * как того требует ТЗ §4.3 (никаких модалок с текстом вместо страницы).
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await rateLimit(request);
    if (limited) return limited;

    const version = await getCurrentVersion(DOCUMENT_KEYS.gazebosOffer);
    if (!version) {
      return apiError("OFFER_NOT_PUBLISHED", "Оферта не опубликована", 404);
    }

    return apiResponse({
      slug: version.slug,
      number: version.number,
      effectiveAt: version.effectiveAt,
    });
  } catch {
    return apiServerError();
  }
}
