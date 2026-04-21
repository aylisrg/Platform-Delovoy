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
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { getBooking, updateBookingStatus, cancelBooking, PSBookingError } from "@/modules/ps-park/service";
import { hasRole } from "@/lib/permissions";
import { checkoutDiscountSchema } from "@/modules/booking/validation";
import type { CheckoutDiscountInput } from "@/modules/booking/validation";

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

    const { reason, confirmPenalty, cashAmount, cardAmount } = body;
    let updated;

    // Users can only cancel their own bookings
    if (status === "CANCELLED" && !hasRole(session.user, "MANAGER")) {
      const result = await cancelBooking(id, session.user.id, reason, confirmPenalty === true);
      if (result.penaltyRequired) {
        return apiError("PENALTY_CONFIRMATION_REQUIRED", "Требуется подтверждение штрафа", 402);
      }
      updated = result.booking;
    } else if (hasRole(session.user, "MANAGER")) {
      const denied = await requireAdminSection(session, "ps-park");
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

      updated = await updateBookingStatus(
        id, status, session.user.id, reason,
        typeof cashAmount === "number" ? cashAmount : undefined,
        typeof cardAmount === "number" ? cardAmount : undefined,
        discountInput
      );
    } else {
      return apiError("FORBIDDEN", "Недостаточно прав для изменения статуса", 403);
    }

    await logAudit(session.user.id, "booking.status_change", "Booking", id, {
      newStatus: status,
    });

    // Enrich response with top-level discount fields per AC-1.8
    const meta = updated.metadata as Record<string, unknown> | null;
    const discount = meta?.discount as Record<string, unknown> | undefined;
    if (discount) {
      return apiResponse({
        ...updated,
        originalAmount: discount.originalAmount,
        discountPercent: discount.percent,
        discountAmount: discount.amount,
        finalAmount: discount.finalAmount,
        discountReason: discount.reason,
      });
    }

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof PSBookingError) {
      const status = error.code === "DISCOUNT_EXCEEDS_LIMIT" ? 422 : 400;
      return apiError(error.code, error.message, status);
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/ps-park/bookings/:id — soft delete booking (SUPERADMIN only)
 * Body: { password: string, reason?: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const authz = await authorizeSuperadminDeletion(request, session);
    if (!authz.ok) return authz.response;

    const { id } = await params;
    const booking = await getBooking(id);
    if (!booking) return apiNotFound("Бронирование не найдено");

    const { prisma } = await import("@/lib/db");
    await prisma.booking.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logDeletion(authz, {
      entity: "Booking",
      entityId: id,
      entityLabel: `PS Park · бронь ${id.slice(0, 8)} (${booking.clientName ?? "без имени"})`,
      moduleSlug: "ps-park",
      snapshot: booking,
    });
    return apiResponse({ id, deletedAt: new Date().toISOString() });
  } catch {
    return apiServerError();
  }
}
