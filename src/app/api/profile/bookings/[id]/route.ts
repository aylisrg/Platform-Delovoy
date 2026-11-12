import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import {
  actOnOwnBooking,
  getOwnBooking,
} from "@/modules/profile/booking-service";
import { ownBookingActionSchema } from "@/modules/profile/validation";
import { BookingManageError } from "@/modules/booking/manage";
import { BookingError } from "@/modules/gazebos/service";
import { PSBookingError } from "@/modules/ps-park/service";
import { OfferError } from "@/modules/booking/offer";
import { recordDashboardEvent } from "@/modules/analytics/dashboard-events";

function respondError(error: unknown) {
  if (error instanceof BookingManageError)
    return apiError(error.code, error.message, error.status);
  if (
    error instanceof BookingError ||
    error instanceof PSBookingError ||
    error instanceof OfferError
  )
    return apiError(error.code, error.message, 409);
  return apiServerError();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  try {
    return apiResponse(await getOwnBooking(session.user.id, (await params).id));
  } catch (error) {
    return respondError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const parsed = ownBookingActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return apiValidationError("Проверьте параметры действия");
  try {
    const data = await actOnOwnBooking(
      session.user.id,
      (await params).id,
      parsed.data,
      {
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
      },
    );
    if (!("confirmationRequired" in data))
      await recordDashboardEvent(session.user.id, "booking_action_succeeded", {
        action: parsed.data.action,
      });
    return apiResponse(data);
  } catch (error) {
    await recordDashboardEvent(session.user.id, "booking_action_failed", {
      action: parsed.data.action,
    });
    return respondError(error);
  }
}
