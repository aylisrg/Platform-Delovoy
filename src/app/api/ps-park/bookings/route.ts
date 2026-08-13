import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError } from "@/lib/api-response";
import { listBookingsPaginated } from "@/modules/ps-park/service";
import { psBookingFilterSchema } from "@/modules/ps-park/validation";
import { getBookingPaymentSummaries } from "@/modules/payments/service";

/**
 * GET /api/ps-park/bookings — list bookings with optional filters, paginated.
 * Каждая бронь обогащается derived-статусом оплаты (один батч-запрос) для
 * бейджа в админ-таблице.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = psBookingFilterSchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { bookings, total, page, perPage } = await listBookingsPaginated(parsed.data);
    const summaries = await getBookingPaymentSummaries(bookings.map((b) => b.id));
    const enriched = bookings.map((b) => ({
      ...b,
      paymentStatus: summaries.get(b.id)?.status ?? "NONE",
    }));
    return apiResponse(enriched, { total, page, perPage });
  } catch {
    return apiServerError();
  }
}
