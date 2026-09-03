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
import { rateLimit } from "@/lib/rate-limit";
import { getWeekTimeline } from "@/modules/booking/week-timeline";
import { weekTimelineQuerySchema } from "@/modules/booking/validation";
import { getMinBookingHours, getOpenCloseHours } from "@/modules/gazebos/service";

/**
 * GET /api/gazebos/week-timeline?weekStart=YYYY-MM-DD — недельный вид расписания
 * (US-5, эпик #442). Тот же гейт, что у GET /api/gazebos/timeline
 * (`requireAdminSection`, не `hasModuleAccess` — ADR 2026-08-23 §7.3), плюс
 * рейт-лимит `authenticated`: запрос тянет семидневный диапазон, и
 * зациклившийся клиент не должен превращать его в нагрузку на БД.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();
    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const rl = await rateLimit(request, "authenticated", session.user.id);
    if (rl) return rl;

    const parsed = weekTimelineQuerySchema.safeParse({
      weekStart: request.nextUrl.searchParams.get("weekStart") ?? "",
    });
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const [{ openHour, closeHour }, minBookingHours] = await Promise.all([
      getOpenCloseHours(),
      getMinBookingHours(),
    ]);
    const data = await getWeekTimeline("gazebos", parsed.data.weekStart, {
      openHour,
      closeHour,
      minBookingHours,
    });
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
