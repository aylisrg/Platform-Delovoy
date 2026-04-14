import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { getAnalytics } from "@/modules/ps-park/service";
import { analyticsQuerySchema } from "@/modules/ps-park/validation";
import { auth } from "@/lib/auth";

/**
 * GET /api/ps-park/analytics?period=week|month|quarter
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const parsed = analyticsQuerySchema.safeParse({
      period: searchParams.get("period") ?? "month",
    });

    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const data = await getAnalytics(parsed.data.period);
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
