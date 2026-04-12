import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getAnalytics } from "@/modules/inventory/service";
import { analyticsQuerySchema } from "@/modules/inventory/validation";

/**
 * GET /api/inventory/analytics — inventory analytics (SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = analyticsQuerySchema.safeParse({
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
    });

    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const analytics = await getAnalytics(parsed.data.dateFrom, parsed.data.dateTo);
    return apiResponse(analytics);
  } catch {
    return apiServerError();
  }
}
