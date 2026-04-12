import { NextRequest } from "next/server";
import { apiResponse, apiUnauthorized, apiValidationError, apiServerError, apiError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { createAdminBooking, PSBookingError } from "@/modules/ps-park/service";
import { adminCreatePSBookingSchema } from "@/modules/ps-park/validation";

/**
 * POST /api/ps-park/admin-book — admin creates booking on behalf of client
 * Requires MANAGER role. Booking is auto-CONFIRMED.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }

    const body = await request.json();
    const parsed = adminCreatePSBookingSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const booking = await createAdminBooking(session.user.id, parsed.data);

    await logAudit(session.user.id, "booking.admin_create", "Booking", booking.id, {
      resourceId: parsed.data.resourceId,
      date: parsed.data.date,
      clientName: parsed.data.clientName,
      clientPhone: parsed.data.clientPhone,
    });

    return apiResponse(booking, undefined, 201);
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
