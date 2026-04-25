import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiResponse, apiError, requireAdminSection, apiServerError } from "@/lib/api-response";
import { getBalance } from "@/modules/analytics/service";

export async function GET(request: NextRequest) {
  const session = await auth();
  const denied = await requireAdminSection(session, "analytics");
  if (denied) return denied;

  const forceRefresh = request.nextUrl.searchParams.get("forceRefresh") === "true";

  if (!process.env.YANDEX_OAUTH_TOKEN || !process.env.YANDEX_DIRECT_CLIENT_LOGIN) {
    return apiError(
      "YANDEX_TOKEN_MISSING",
      "Не настроены YANDEX_OAUTH_TOKEN / YANDEX_DIRECT_CLIENT_LOGIN",
      503
    );
  }

  try {
    const data = await getBalance(forceRefresh);
    return apiResponse(data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("YANDEX_")) {
      return apiError("EXTERNAL_API_ERROR", error.message, 502);
    }
    return apiServerError();
  }
}
