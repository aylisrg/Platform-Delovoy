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
import { getPrintableDaySchedule } from "@/modules/booking/print-schedule";
import { printScheduleQuerySchema } from "@/modules/booking/validation";

/**
 * GET /api/ps-park/print-schedule?date=YYYY-MM-DD&includeCancelled=true|false
 * Плоский список броней дня для печатного листа (#668) — читаемый доступ,
 * тот же гейт, что и у GET /api/ps-park/timeline.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const parsed = printScheduleQuerySchema.safeParse({
      date: searchParams.get("date") ?? "",
      includeCancelled: searchParams.get("includeCancelled"),
    });

    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const rows = await getPrintableDaySchedule("ps-park", parsed.data.date, parsed.data.includeCancelled);
    return apiResponse(rows);
  } catch {
    return apiServerError();
  }
}
