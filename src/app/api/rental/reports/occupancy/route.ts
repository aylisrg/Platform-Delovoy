import { apiResponse, apiUnauthorized, apiForbidden, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getOccupancyReport } from "@/modules/rental/service";

/**
 * GET /api/rental/reports/occupancy — occupancy by building (MANAGER/SUPERADMIN)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const report = await getOccupancyReport();
    return apiResponse(report);
  } catch {
    return apiServerError();
  }
}
