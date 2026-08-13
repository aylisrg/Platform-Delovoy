import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { verifyUserPassword } from "@/lib/deletion";
import { restoreBooking, BookingRestoreError } from "@/modules/booking/restore";
import { restoreBookingSchema } from "@/modules/booking/validation";

const MODULE_SLUG = "ps-park";

/**
 * POST /api/ps-park/bookings/:id/restore — вернуть ошибочно завершённую или
 * отменённую бронь в статус «Подтверждена».
 *
 * Только SUPERADMIN и только с повторным вводом пароля: действие затрагивает
 * деньги и расписание, поэтому строгость та же, что у удаления данных (AC-1,
 * AC-7). Окно по времени и проверка занятости слота — в `restoreBooking()`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "SUPERADMIN")) {
      return apiForbidden("Восстановление брони доступно только суперадмину");
    }
    const denied = await requireAdminSection(session, MODULE_SLUG);
    if (denied) return denied;

    const body: unknown = await request.json().catch(() => null);
    const parsed = restoreBookingSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const check = await verifyUserPassword(session.user.id, parsed.data.password);
    if (!check.ok) {
      if (check.reason === "NO_PASSWORD") {
        return apiError(
          "PASSWORD_NOT_SET",
          "У вашей учётной записи не задан пароль — восстановление недоступно",
          403
        );
      }
      return apiError("INVALID_PASSWORD", "Неверный пароль", 403);
    }

    const { id } = await params;
    const restored = await restoreBooking({
      bookingId: id,
      moduleSlug: MODULE_SLUG,
      actorId: session.user.id,
      reason: parsed.data.reason,
    });

    return apiResponse(restored);
  } catch (error) {
    if (error instanceof BookingRestoreError) {
      const status =
        error.code === "BOOKING_NOT_FOUND"
          ? 404
          : error.code === "SLOT_TAKEN" || error.code === "ALREADY_RESTORED"
            ? 409
            : 422;
      return apiError(error.code, error.message, status, error.metadata);
    }
    // Переход отклонён FSM — например, бронь не в COMPLETED/CANCELLED.
    if (error instanceof Error && error.name === "BookingTransitionError") {
      return apiError("INVALID_STATUS_TRANSITION", error.message, 409);
    }
    return apiServerError();
  }
}
