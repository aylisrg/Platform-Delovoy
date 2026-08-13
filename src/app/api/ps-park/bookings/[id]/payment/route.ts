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
import { recordPrepayment, BookingPrepaymentError } from "@/modules/booking/prepayment";
import { recordPrepaymentSchema } from "@/modules/booking/validation";

const MODULE_SLUG = "ps-park";

/**
 * POST /api/ps-park/bookings/:id/payment — принять оплату, не завершая бронь.
 *
 * Владельцу нужен статус «ОПЛАЧЕНО», который можно поставить руками: гость
 * платит наличными при подтверждении по телефону, а до чекаута такую бронь
 * система считала неоплаченной. Жизненный цикл брони не меняется.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Недостаточно прав для приёма оплаты");
    }
    const denied = await requireAdminSection(session, MODULE_SLUG);
    if (denied) return denied;

    const body: unknown = await request.json().catch(() => null);
    const parsed = recordPrepaymentSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const { id } = await params;
    const updated = await recordPrepayment({
      bookingId: id,
      moduleSlug: MODULE_SLUG,
      actorId: session.user.id,
      cashAmount: parsed.data.cashAmount,
      cardAmount: parsed.data.cardAmount,
    });

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof BookingPrepaymentError) {
      const status =
        error.code === "BOOKING_NOT_FOUND" ? 404 : error.code === "BOOKING_CLOSED" ? 409 : 422;
      return apiError(error.code, error.message, status);
    }
    return apiServerError();
  }
}
