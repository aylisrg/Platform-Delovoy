import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiResponse, apiServerError, requireAdminSection } from "@/lib/api-response";
import { getGazebosMarketingStats } from "@/modules/gazebos/marketing-service";

/**
 * GET /api/gazebos/marketing
 * Returns aggregated marketing stats from Avito and Yandex.
 * Requires MANAGER (gazebos) or SUPERADMIN role.
 *
 * Query params:
 *   dateFrom - YYYY-MM-DD (default: 30 days ago)
 *   dateTo   - YYYY-MM-DD (default: today)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;

    const stats = await getGazebosMarketingStats(dateFrom, dateTo);
    return apiResponse(stats);
  } catch {
    return apiServerError();
  }
}
