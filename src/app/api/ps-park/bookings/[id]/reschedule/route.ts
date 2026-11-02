import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { apiResponse, apiError, apiUnauthorized, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { reschedulePSReservationSchema } from "@/modules/ps-park/validation";
import { reschedulePaidReservation } from "@/modules/ps-park/reschedule";
import { PSBookingError } from "@/modules/ps-park/service";
import { InventoryError } from "@/modules/inventory/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiError("FORBIDDEN", "Недостаточно прав", 403);
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;
    const parsed = reschedulePSReservationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);
    const { id } = await params;
    return apiResponse(await reschedulePaidReservation(id, session.user.id, parsed.data));
  } catch (error) {
    if (error instanceof PSBookingError || error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
