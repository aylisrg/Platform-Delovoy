import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { extendBooking, PSBookingError } from "@/modules/ps-park/service";

/**
 * POST /api/ps-park/bookings/:id/extend
 * Extend a CONFIRMED booking by 1 hour.
 * Requires MANAGER role.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }

    const { id } = await params;
    const updated = await extendBooking(id, session.user.id);

    await logAudit(session.user.id, "booking.extend", "Booking", id, {
      newEndTime: updated.endTime.toISOString(),
    });

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
