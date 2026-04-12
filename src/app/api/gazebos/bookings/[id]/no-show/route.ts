import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiNotFound, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { markNoShow, BookingError } from "@/modules/gazebos/service";

/**
 * POST /api/gazebos/bookings/:id/no-show — mark booking as NO_SHOW
 * Actor: MANAGER / SUPERADMIN only
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const { id } = await params;
    const booking = await markNoShow(id, session.user.id, "manual");

    await logAudit(session.user.id, "booking.no_show", "Booking", id, {
      newStatus: "NO_SHOW",
      reason: "manual",
    });

    return apiResponse(booking);
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.code === "BOOKING_NOT_FOUND") return apiNotFound(error.message);
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
