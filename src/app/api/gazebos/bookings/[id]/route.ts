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
import { getBooking, updateBookingStatus, cancelBooking, BookingError } from "@/modules/gazebos/service";
import { hasRole } from "@/lib/permissions";
import { checkoutDiscountSchema } from "@/modules/booking/validation";
import type { CheckoutDiscountInput } from "@/modules/booking/validation";

/**
 * GET /api/gazebos/bookings/:id — get single booking
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
 * PATCH /api/gazebos/bookings/:id — update booking status
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

    const { reason, confirmPenalty } = body;
    let updated;

    // Users can only cancel their own bookings
    if (status === "CANCELLED" && !hasRole(session.user, "MANAGER")) {
      const result = await cancelBooking(id, session.user.id, reason, confirmPenalty === true);
      if (result.penaltyRequired) {
        return apiError("PENALTY_CONFIRMATION_REQUIRED", "Требуется подтверждение штрафа", 402);
      }
      updated = result.booking;
    } else if (hasRole(session.user, "MANAGER")) {
      // Managers can change any status — check section permission
      const denied = await requireAdminSection(session, "gazebos");
      if (denied) return denied;

      // Parse discount fields for COMPLETED checkout
      let discountInput: CheckoutDiscountInput | undefined;
      if (status === "COMPLETED" && body.discountPercent !== undefined && body.discountPercent > 0) {
        const parsed = checkoutDiscountSchema.safeParse({
          discountPercent: body.discountPercent,
          discountReason: body.discountReason,
          discountNote: body.discountNote,
        });
        if (!parsed.success) {
          return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
        }
        discountInput = parsed.data;
      }

      updated = await updateBookingStatus(id, status, session.user.id, reason, discountInput);
    } else {
      return apiError("FORBIDDEN", "Недостаточно прав для изменения статуса", 403);
    }

    await logAudit(session.user.id, "booking.status_change", "Booking", id, {
      newStatus: status,
    });

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof BookingError) {
      const status = error.code === "DISCOUNT_EXCEEDS_LIMIT" ? 422 : 400;
      return apiError(error.code, error.message, status);
    }
    return apiServerError();
  }
}
