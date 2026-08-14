import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { getBooking, updateBookingStatus, cancelBooking, PSBookingError, softDeleteBooking, hardDeleteBooking } from "@/modules/ps-park/service";
import { hasRole } from "@/lib/permissions";
import { checkoutDiscountSchema, updateBookingStatusSchema } from "@/modules/booking/validation";
import type { CheckoutDiscountInput } from "@/modules/booking/validation";

/**
 * GET /api/ps-park/bookings/:id — get single booking
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

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
    const body: unknown = await request.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return apiError("VALIDATION_ERROR", "Некорректное тело запроса", 422);
    }
    const raw = body as Record<string, unknown>;

    if (raw.status === undefined || raw.status === null || raw.status === "") {
      return apiError("VALIDATION_ERROR", "Укажите статус", 422);
    }

    // Тело целиком через Zod (#432) — статус только из enum, суммы кассовой
    // разбивки неотрицательные, причина с потолком длины.
    const parsedStatus = updateBookingStatusSchema.safeParse(raw);
    if (!parsedStatus.success) {
      return apiError("VALIDATION_ERROR", parsedStatus.error.issues[0].message, 422);
    }
    const {
      status,
      reason,
      confirmPenalty,
      cashAmount,
      cardAmount,
      subscriptionId,
    } = parsedStatus.data;
    // Статус до изменения — чтобы в истории брони было «Подтверждена →
    // Неявка», а не безадресное «новый статус» (AC-2, AC-5).
    const previousStatus = (await getBooking(id))?.status ?? null;
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

      // Parse discount fields for COMPLETED checkout.
      // Скидка = ноль/отсутствует → чекаут без скидки; всё остальное (включая
      // мусор вроде строки) уходит в схему и падает в 422, как и до фикса.
      const rawPercent = raw.discountPercent;
      const wantsDiscount =
        typeof rawPercent === "number"
          ? rawPercent > 0
          : rawPercent !== undefined && rawPercent !== null;

      let discountInput: CheckoutDiscountInput | undefined;
      if (status === "COMPLETED" && wantsDiscount) {
        const parsed = checkoutDiscountSchema.safeParse({
          discountPercent: raw.discountPercent,
          discountReason: raw.discountReason,
          discountNote: raw.discountNote,
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
        cashAmount,
        cardAmount,
        discountInput,
        "MANAGER",
        subscriptionId
      );
    } else {
      return apiError("FORBIDDEN", "Недостаточно прав для изменения статуса", 403);
    }

    // session.complete / session.cancel / session.auto_complete are logged
    // inside updateBookingStatus's transaction (atomic with FT and item
    // returns). Here we only emit booking.status_change for the remaining
    // non-terminal transitions: CONFIRMED, CHECKED_IN, NO_SHOW.
    if (status !== "COMPLETED" && status !== "CANCELLED") {
      await logAudit(session.user.id, "booking.status_change", "Booking", id, {
        newStatus: status,
        ...(previousStatus && { previousStatus }),
        ...(reason && { reason }),
        moduleSlug: "ps-park",
      });
    }

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
      const conflictCodes = new Set([
        "INVALID_STATUS_TRANSITION",
        "ALREADY_COMPLETED",
        "ALREADY_CANCELLED",
      ]);
      const unprocessableCodes = new Set([
        "DISCOUNT_EXCEEDS_LIMIT",
        "PAYMENT_REQUIRED",
        "INVALID_PAYMENT_COMBINATION",
        "INVALID_SUBSCRIPTION",
        "INSUFFICIENT_HOURS",
        "INVALID_HOURS",
      ]);
      // FORBIDDEN приходит из FSM, когда переход существует, но роли не
      // хватает прав — например, MANAGER пытается вернуть закрытую бронь
      // мимо `restoreBooking()`. Это 403, а не «непонятный 400».
      const status = error.code === "FORBIDDEN"
        ? 403
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
 * DELETE /api/ps-park/bookings/:id
 *  - SUPERADMIN can hard-delete with `?hard=true` (physically removes the row).
 *  - Otherwise (default): soft-delete — sets `deletedAt = now()`. Requires SUPERADMIN
 *    with password re-auth per authorizeSuperadminDeletion contract.
 *  - If the booking was CONFIRMED and contained items, inventory is returned to stock
 *    in the same transaction.
 *
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

    const url = new URL(request.url);
    const hard =
      url.searchParams.get("hard") === "true" &&
      (session?.user?.role === "SUPERADMIN" || session?.user?.role === "ADMIN");

    const performedById = authz.actor.id;

    if (hard) {
      await hardDeleteBooking(id, performedById);
      await logDeletion(authz, {
        entity: "Booking",
        entityId: id,
        entityLabel: `PS Park · бронь ${id.slice(0, 8)} (${booking.clientName ?? "без имени"})`,
        moduleSlug: "ps-park",
        snapshot: booking,
        deletionType: "HARD",
      });
      await logAudit(performedById, "booking.hard_delete", "Booking", id, {
        moduleSlug: "ps-park",
        reason: authz.reason,
      });
      return apiResponse({ id, hardDeleted: true });
    }

    await softDeleteBooking(id, performedById);
    await logDeletion(authz, {
      entity: "Booking",
      entityId: id,
      entityLabel: `PS Park · бронь ${id.slice(0, 8)} (${booking.clientName ?? "без имени"})`,
      moduleSlug: "ps-park",
      snapshot: booking,
    });
    await logAudit(performedById, "booking.soft_delete", "Booking", id, {
      moduleSlug: "ps-park",
      reason: authz.reason,
    });
    return apiResponse({ id, deletedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message, 400);
    }
    return apiServerError();
  }
}
