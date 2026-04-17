import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { skipLink } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/skip
 * Skip account linking — remember the choice for 30 days.
 */
export async function POST(request: NextRequest) {
  try {
    const webappUser = await verifyWebAppToken(request);
    if (!webappUser) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }

    await skipLink(webappUser.telegramId);

    return apiResponse({ skipped: true });
  } catch (error) {
    console.error("[WebApp Link Skip] Error:", error);
    return apiServerError();
  }
}
