import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
  apiForbidden,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getBookingHistory } from "@/modules/booking/history";
import { restoreWindowHoursLeft } from "@/modules/booking/restore";
import { getBooking } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park/bookings/:id/history — лента событий брони.
 *
 * Права те же, что у самой карточки брони: MANAGER своего раздела и выше.
 * Новых ролей не вводим (AC-4).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Недостаточно прав для просмотра истории брони");
    }
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { id } = await params;
    const booking = await getBooking(id);
    if (!booking) return apiNotFound("Бронирование не найдено");

    const events = await getBookingHistory(id, "ps-park");

    // Кнопку восстановления рисует клиент — ему нужно знать, открыто ли окно
    // и хватает ли прав, чтобы не показывать заведомо мёртвую кнопку.
    const closed = booking.status === "COMPLETED" || booking.status === "CANCELLED";
    const hoursLeft = closed ? restoreWindowHoursLeft(booking.updatedAt) : 0;

    return apiResponse({
      events,
      status: booking.status,
      restore: {
        available: closed && hoursLeft > 0 && hasRole(session.user, "SUPERADMIN"),
        hoursLeft,
        reasonUnavailable: !closed
          ? "Бронь не закрыта"
          : hoursLeft <= 0
            ? "Окно восстановления истекло"
            : !hasRole(session.user, "SUPERADMIN")
              ? "Восстановление доступно только суперадмину"
              : null,
      },
    });
  } catch {
    return apiServerError();
  }
}
