import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { linkRequestSchema } from "@/modules/telegram-link/validation";
import { requestLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/request — send a one-time code by email for linking
 * this Telegram to an existing account (ADR 2026-10-25 §5.3, PRD US-E3).
 *
 * Always answers the same «Если такой аккаунт есть…» (AC-E3.3); 422 for
 * phone (AC-E3.6), 503 without SMTP, 502 when the email could not be sent
 * (AC-E3.5), 429 over the OTP limits. Neither the code nor the address is logged.
 */
export async function POST(request: NextRequest) {
  try {
    const webappUser = await verifyWebAppToken(request);
    if (!webappUser) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }

    const limited = await rateLimit(request, "authenticated", webappUser.id);
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
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
    console.error("[WebApp Link Request] Error:", error instanceof Error ? error.message : error);
    return apiServerError();
  }
}
