import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiResponse, apiError, requireAdminSection, apiServerError } from "@/lib/api-response";
import { analyticsQuerySchema } from "@/modules/analytics/validation";
import { getCampaigns, resolveDateRange } from "@/modules/analytics/service";

export async function GET(request: NextRequest) {
  const session = await auth();
  const denied = await requireAdminSection(session, "analytics");
  if (denied) return denied;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = analyticsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
  }

  if (!process.env.YANDEX_OAUTH_TOKEN || !process.env.YANDEX_DIRECT_CLIENT_LOGIN) {
    return apiError("YANDEX_TOKEN_MISSING", "Не настроены YANDEX_OAUTH_TOKEN / YANDEX_DIRECT_CLIENT_LOGIN", 503);
  }

  try {
    const dateRange = resolveDateRange(parsed.data);
    const data = await getCampaigns(dateRange, parsed.data.forceRefresh);
    return apiResponse(data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("YANDEX_")) {
      return apiError("EXTERNAL_API_ERROR", error.message, 502);
    }
    return apiServerError();
  }
}
