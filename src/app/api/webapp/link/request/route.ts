import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { linkRequestSchema } from "@/modules/telegram-link/validation";
import { requestLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/request
 * Send OTP to email or phone for linking Telegram to an existing account.
 */
export async function POST(request: NextRequest) {
  try {
    const webappUser = await verifyWebAppToken(request);
    if (!webappUser) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }

    const body = await request.json();
    const parsed = linkRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join(", "),
        422
      );
    }

    const result = await requestLink(webappUser.telegramId, parsed.data);
    return apiResponse(result);
  } catch (error) {
    if (error instanceof LinkError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error("[WebApp Link Request] Error:", error);
    return apiServerError();
  }
}
