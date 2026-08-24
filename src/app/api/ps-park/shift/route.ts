import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getDayReport, getTodayShift, openShift, closeShift, recordShiftHandover, PSBookingError } from "@/modules/ps-park/service";
import { shiftHandoverSchema } from "@/modules/ps-park/validation";

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
 * Body:
 *   { action: "open"  | "close", date, notes? }
 *   { action: "handover", date, amount, recipient, note? } — передача
 *     наличной выручки в бухгалтерию; пишет фактически переданную сумму
 *     и расхождение с расчётной.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const body = await request.json();
    const { action, date, notes } = body as {
      action: "open" | "close" | "handover";
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
    } else if (action === "handover") {
      const parsed = shiftHandoverSchema.safeParse(body);
      if (!parsed.success) {
        return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
      }
      const shift = await recordShiftHandover(date, session.user.id, managerName, parsed.data);
      return apiResponse(shift);
    } else {
      return apiError("VALIDATION_ERROR", "Неизвестное действие", 422);
    }
  } catch (error) {
    if (error instanceof PSBookingError) {
      // Конфликты состояния смены — 409, а не безликий 400: клиент по коду
      // понимает, что делать (закрыть смену / обновить экран).
      const conflictCodes = new Set([
        "SHIFT_ALREADY_OPEN",
        "SHIFT_ALREADY_CLOSED",
        "SHIFT_NOT_CLOSED",
        "ALREADY_HANDED_OVER",
      ]);
      const unprocessableCodes = new Set([
        "DISCREPANCY_NOTE_REQUIRED",
        "RECIPIENT_REQUIRED",
      ]);
      const status = error.code === "SHIFT_NOT_FOUND"
        ? 404
        : conflictCodes.has(error.code)
          ? 409
          : unprocessableCodes.has(error.code)
            ? 422
            : 400;
      return apiError(error.code, error.message, status);
    }
    return apiServerError();
  }
}
