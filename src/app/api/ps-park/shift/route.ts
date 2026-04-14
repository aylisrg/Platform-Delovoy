import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getDayReport, getTodayShift, openShift, closeShift, PSBookingError } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park/shift?date=YYYY-MM-DD
 * Returns today's shift status + day report aggregation
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

    const [shift, report] = await Promise.all([
      getTodayShift(date),
      getDayReport(date),
    ]);

    return apiResponse({ shift, report });
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/ps-park/shift
 * Body: { action: "open" | "close", date: string, notes?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const body = await request.json();
    const { action, date, notes } = body as {
      action: "open" | "close";
      date: string;
      notes?: string;
    };

    if (!action || !date) {
      return apiError("VALIDATION_ERROR", "Укажите action и date", 422);
    }

    const managerName = session.user.name ?? session.user.email ?? "Менеджер";

    if (action === "open") {
      const shift = await openShift(date, session.user.id, managerName);
      return apiResponse(shift);
    } else if (action === "close") {
      const shift = await closeShift(date, session.user.id, managerName, notes);
      return apiResponse(shift);
    } else {
      return apiError("VALIDATION_ERROR", "Неизвестное действие", 422);
    }
  } catch (error) {
    if (error instanceof PSBookingError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
