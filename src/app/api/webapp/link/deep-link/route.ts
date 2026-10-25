import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { safeCompare } from "@/lib/cron-auth";
import { deepLinkSchema } from "@/modules/telegram-link/validation";
import { processDeepLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/deep-link
 * Internal endpoint called by the Telegram bot to process deep link token.
 * Auth: x-bot-token header, compared in constant time (ADR 2026-10-25 §6.2).
 * 409 TELEGRAM_IN_USE_MERGE_REQUESTED — the bot shows the message as-is.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.TELEGRAM_BOT_TOKEN;
    const botToken = request.headers.get("x-bot-token");
    if (!expected || !botToken || !safeCompare(botToken, expected)) {
      return apiError("UNAUTHORIZED", "Invalid bot token", 401);
    }

    const body: unknown = await request.json().catch(() => null);
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
    console.error("[WebApp Deep Link] Error:", error instanceof Error ? error.message : error);
    return apiServerError();
  }
}
