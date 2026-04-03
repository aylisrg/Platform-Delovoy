import { NextRequest } from "next/server";
import { apiResponse, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getMonthlyReport } from "@/modules/rental/service";
import { reportQuerySchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/reports?year=2026&month=4 — monthly financial report (MANAGER/SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const now = new Date();
    const params = {
      year: request.nextUrl.searchParams.get("year") ?? String(now.getFullYear()),
      month: request.nextUrl.searchParams.get("month") ?? String(now.getMonth() + 1),
    };

    const parsed = reportQuerySchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const report = await getMonthlyReport(parsed.data.year, parsed.data.month);
    return apiResponse(report);
  } catch {
    return apiServerError();
  }
}
