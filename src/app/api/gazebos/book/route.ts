import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { log, logAudit } from "@/lib/logger";
import { createBooking, BookingError } from "@/modules/gazebos/service";
import { createBookingSchema } from "@/modules/gazebos/validation";
import { InventoryError } from "@/modules/inventory/service";

/**
 * POST /api/gazebos/book — create a new booking.
 *
 * Supports two modes:
 *   1. Authenticated: userId pulled from the session.
 *   2. Guest checkout: session absent, body must include guestName + guestPhone.
 *      Contact info is stored on the Booking row (clientName/clientPhone) so
 *      the manager can reach out.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id ?? null;

    const body = await request.json();
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    // Guest branch needs contact info to be useful. We block the request here
    // (with a clear error) rather than at the schema level so authed callers
    // don't have to send empty guest fields.
    if (!userId && (!parsed.data.guestName || !parsed.data.guestPhone)) {
      return apiError(
        "GUEST_CONTACTS_REQUIRED",
        "Для бронирования без регистрации укажите имя и телефон",
        400
      );
    }

    const booking = await createBooking(userId, parsed.data);

    if (userId) {
      await logAudit(userId, "booking.create", "Booking", booking.id, {
        resourceId: parsed.data.resourceId,
        date: parsed.data.date,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
      });
    } else {
      // Guest bookings aren't tied to a User row, so they can't land in AuditLog.
      // SystemEvent keeps an INFO-level trace for the admin dashboard.
      await log.info("gazebos", "Guest booking created", {
        bookingId: booking.id,
        resourceId: parsed.data.resourceId,
        date: parsed.data.date,
        guestPhone: parsed.data.guestPhone,
      });
    }

    return apiResponse(booking, undefined, 201);
  } catch (error) {
    if (error instanceof BookingError) {
      return apiError(error.code, error.message);
    }
    if (error instanceof InventoryError) {
      return apiError(error.code, error.message, 400);
    }
    return apiServerError();
  }
}
