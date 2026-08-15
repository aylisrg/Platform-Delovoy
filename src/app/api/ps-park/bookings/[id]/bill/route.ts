import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getBookingBill, PSBookingError } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park/bookings/:id/bill
 * Returns bill summary for a booking (hours + items + totals).
 * Requires MANAGER role + ps-park module access.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

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
