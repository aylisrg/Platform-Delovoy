import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import {
  dashboardStatsSchema,
  getDashboardEventStats,
} from "@/modules/analytics/dashboard-events";

export async function GET(request: NextRequest) {
  const denied = await requireAdminSection(await auth(), "analytics");
  if (denied) return denied;
  const parsed = dashboardStatsSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return apiValidationError(parsed.error.issues[0].message);
  try {
    return apiResponse(
      await getDashboardEventStats(parsed.data.dateFrom, parsed.data.dateTo),
    );
  } catch {
    return apiServerError();
  }
}
