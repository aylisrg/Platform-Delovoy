import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError } from "@/lib/api-response";
import { listBookings } from "@/modules/gazebos/service";
import { bookingFilterSchema } from "@/modules/gazebos/validation";

/**
 * GET /api/gazebos/bookings — list bookings with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = bookingFilterSchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { bookings, total } = await listBookings(parsed.data);
    return apiResponse(bookings, { total });
  } catch {
    return apiServerError();
  }
}
