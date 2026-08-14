import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getTimeline } from "@/modules/gazebos/service";
import { timelineQuerySchema } from "@/modules/gazebos/validation";

/**
 * GET /api/gazebos/timeline?date=YYYY-MM-DD
 * Returns resources + bookings for a given date, optimized for the timeline grid.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();
    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const parsed = timelineQuerySchema.safeParse({
      date: searchParams.get("date") ?? "",
    });

    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const data = await getTimeline(parsed.data.date);
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
