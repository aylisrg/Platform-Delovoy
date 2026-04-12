import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { getBookingBill, PSBookingError } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park/bookings/:id/bill
 * Returns bill summary for a booking (hours + items + totals).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bill = await getBookingBill(id);
    return apiResponse(bill);
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
