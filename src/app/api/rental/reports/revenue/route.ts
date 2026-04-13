import { NextRequest } from "next/server";
import { apiResponse, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getRevenueReport } from "@/modules/rental/service";
import { revenueReportSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/reports/revenue — revenue report (MANAGER/SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = revenueReportSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const report = await getRevenueReport(parsed.data.building);
    return apiResponse(report);
  } catch {
    return apiServerError();
  }
}
