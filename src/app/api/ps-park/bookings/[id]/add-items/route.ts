import { NextRequest } from "next/server";
import { apiResponse, apiUnauthorized, apiValidationError, apiServerError, apiError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { addItemsToBooking, PSBookingError } from "@/modules/ps-park/service";
import { addBookingItemsSchema } from "@/modules/ps-park/validation";

/**
 * POST /api/ps-park/bookings/:id/add-items — add inventory items to an existing booking.
 * Requires MANAGER role. Works on PENDING and CONFIRMED bookings only.
 * CONFIRMED bookings: stock deducted immediately.
 * PENDING bookings: items snapshot stored, stock deducted on confirmation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = addBookingItemsSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const booking = await addItemsToBooking(id, session.user.id, parsed.data.items);

    await logAudit(session.user.id, "booking.add_items", "Booking", id, {
      itemCount: parsed.data.items.length,
    });

    return apiResponse(booking);
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
