import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import {
  verifyWebAppToken,
  signWebAppToken,
  WebAppAuthConfigError,
} from "@/lib/webapp-auth";
import { linkConfirmSchema } from "@/modules/telegram-link/validation";
import { confirmLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/confirm
 * Confirm OTP and link Telegram to an existing account.
 * Returns a new JWT with the correct userId.
 */
export async function POST(request: NextRequest) {
  try {
    const webappUser = await verifyWebAppToken(request);
    if (!webappUser) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }

    const body = await request.json();
    const parsed = linkConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join(", "),
        422
      );
    }

    const result = await confirmLink(webappUser.telegramId, parsed.data.code);

    // Issue new JWT with the linked user's ID
    const newToken = await signWebAppToken({
      sub: result.user.id,
      telegramId: result.user.telegramId ?? webappUser.telegramId,
      role: result.user.role,
    });

    return apiResponse({
      ...result,
      token: newToken,
    });
  } catch (error) {
    if (error instanceof LinkError) {
      return apiError(error.code, error.message, error.status);
    }
    if (error instanceof WebAppAuthConfigError) {
      return apiError(
        "NOT_CONFIGURED",
        "Аутентификация Mini App не настроена",
        503
      );
    }
    console.error("[WebApp Link Confirm] Error:", error);
    return apiServerError();
  }
}
