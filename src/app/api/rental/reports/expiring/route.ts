import { NextRequest } from "next/server";
import { apiResponse, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getExpiringContracts } from "@/modules/rental/service";
import { expiringReportSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/reports/expiring — expiring contracts (MANAGER/SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = expiringReportSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const contracts = await getExpiringContracts(parsed.data.days);
    return apiResponse(contracts);
  } catch {
    return apiServerError();
  }
}
