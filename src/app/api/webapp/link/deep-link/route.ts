import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { deepLinkSchema } from "@/modules/telegram-link/validation";
import { processDeepLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/deep-link
 * Internal endpoint called by the Telegram bot to process deep link token.
 * Auth: x-bot-token header.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify bot token
    const botToken = request.headers.get("x-bot-token");
    if (!botToken || botToken !== process.env.TELEGRAM_BOT_TOKEN) {
      return apiError("UNAUTHORIZED", "Invalid bot token", 401);
    }

    const body = await request.json();
    const parsed = deepLinkSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join(", "),
        422
      );
    }

    const result = await processDeepLink(parsed.data);
    return apiResponse(result);
  } catch (error) {
    if (error instanceof LinkError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error("[WebApp Deep Link] Error:", error);
    return apiServerError();
  }
}
