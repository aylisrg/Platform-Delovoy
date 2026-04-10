import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getBooking, updateBookingStatus, cancelBooking, PSBookingError } from "@/modules/ps-park/service";
import { hasRole } from "@/lib/permissions";

/**
 * GET /api/ps-park/bookings/:id — get single booking
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const booking = await getBooking(id);
    if (!booking) return apiNotFound("Бронирование не найдено");
    return apiResponse(booking);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/ps-park/bookings/:id — update booking status
 * Body: { status: "CONFIRMED" | "CANCELLED" | "COMPLETED" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status) {
      return apiError("VALIDATION_ERROR", "Укажите статус", 422);
    }

    let updated;

    // Users can only cancel their own bookings
    if (status === "CANCELLED" && !hasRole(session.user, "MANAGER")) {
      updated = await cancelBooking(id, session.user.id);
    } else if (hasRole(session.user, "MANAGER")) {
      const denied = await requireAdminSection(session, "ps-park");
      if (denied) return denied;
      updated = await updateBookingStatus(id, status);
    } else {
      return apiError("FORBIDDEN", "Недостаточно прав для изменения статуса", 403);
    }

    await logAudit(session.user.id, "booking.status_change", "Booking", id, {
      newStatus: status,
    });

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
