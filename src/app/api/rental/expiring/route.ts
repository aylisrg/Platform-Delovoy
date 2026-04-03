import { NextRequest } from "next/server";
import { apiResponse, apiUnauthorized, apiForbidden, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getExpiringContracts } from "@/modules/rental/service";

/**
 * GET /api/rental/expiring — contracts expiring in the next N days (default 30)
 * Required by CLAUDE.md API standards
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    const contracts = await getExpiringContracts(isNaN(days) ? 30 : days);
    return apiResponse(contracts);
  } catch {
    return apiServerError();
  }
}
