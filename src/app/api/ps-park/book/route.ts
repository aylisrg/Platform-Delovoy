import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { createBooking, PSBookingError } from "@/modules/ps-park/service";
import { createPSBookingSchema } from "@/modules/ps-park/validation";

/**
 * POST /api/ps-park/book — create a new booking
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const body = await request.json();
    const parsed = createPSBookingSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const booking = await createBooking(session.user.id, parsed.data);

    await logAudit(session.user.id, "booking.create", "Booking", booking.id, {
      resourceId: parsed.data.resourceId,
      date: parsed.data.date,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    });

    return apiResponse(booking, undefined, 201);
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
