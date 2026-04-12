import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiNotFound, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { checkInBooking, BookingError } from "@/modules/gazebos/service";

/**
 * POST /api/gazebos/bookings/:id/checkin — mark booking as CHECKED_IN
 * Actor: MANAGER / SUPERADMIN
 * Also handles NO_SHOW → CHECKED_IN (late arrival)
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
    const booking = await checkInBooking(id, session.user.id);

    await logAudit(session.user.id, "booking.checkin", "Booking", id, {
      newStatus: "CHECKED_IN",
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
