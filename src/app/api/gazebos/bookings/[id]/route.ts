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
import { getBooking, updateBookingStatus, updateBookingDetails, cancelBooking, BookingError } from "@/modules/gazebos/service";
import { enqueueNotification } from "@/modules/notifications/queue";
import { formatTime } from "@/lib/format";
import { hasRole } from "@/lib/permissions";
import { checkoutDiscountSchema } from "@/modules/booking/validation";
import { updateBookingDetailsSchema } from "@/modules/gazebos/validation";
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

    // No status field → this is a details edit (date/time/resource/guests/
    // comment/contacts). Restricted to ADMIN / SUPERADMIN / MANAGER with the
    // gazebos section; the change is logged and notified inside the service.
    if (!status) {
      const denied = await requireAdminSection(session, "gazebos");
      if (denied) return denied;

      const parsed = updateBookingDetailsSchema.safeParse(body);
      if (!parsed.success) {
        return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
      }

      const edited = await updateBookingDetails(id, session.user.id, parsed.data);
      return apiResponse(edited);
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

      updated = await updateBookingStatus(
        id,
        status,
        session.user.id,
        reason,
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
    if (error instanceof BookingError) {
      const notFoundCodes = new Set([
        "BOOKING_NOT_FOUND",
        "RESOURCE_NOT_FOUND",
      ]);
      const conflictCodes = new Set([
        "INVALID_STATUS_TRANSITION",
        "ALREADY_COMPLETED",
        "ALREADY_CANCELLED",
        "BOOKING_CONFLICT",
      ]);
      const unprocessableCodes = new Set([
        "DISCOUNT_EXCEEDS_LIMIT",
        "PAYMENT_REQUIRED",
        "CAPACITY_EXCEEDED",
        "DURATION_BELOW_MIN",
        "BOOKING_CANCELLED",
        "INVALID_TIME_RANGE",
      ]);
      const status = notFoundCodes.has(error.code)
        ? 404
        : conflictCodes.has(error.code)
          ? 409
          : unprocessableCodes.has(error.code)
            ? 422
            : 400;
      return apiError(error.code, error.message, status, error.metadata);
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/gazebos/bookings/:id — soft delete booking (ADMIN + SUPERADMIN)
 * Body: { password: string, reason?: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const authz = await authorizeSuperadminDeletion(request, session, {
      allowAdmin: true,
    });
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
      entityLabel: `Беседка · бронь ${id.slice(0, 8)} (${booking.clientName ?? "без имени"})`,
      moduleSlug: "gazebos",
      snapshot: booking,
    });

    // Notify the dedicated gazebos Telegram channel (if enabled for this event).
    const resource = await prisma.resource.findUnique({
      where: { id: booking.resourceId },
      select: { name: true },
    });
    enqueueNotification({
      type: "booking.deleted",
      moduleSlug: "gazebos",
      entityId: id,
      actor: "admin",
      data: {
        resourceName: resource?.name ?? "",
        date: booking.date.toISOString().split("T")[0],
        startTime: formatTime(booking.startTime),
        endTime: formatTime(booking.endTime),
        userName: booking.clientName ?? "без имени",
      },
    });

    return apiResponse({ id, deletedAt: new Date().toISOString() });
  } catch {
    return apiServerError();
  }
}
