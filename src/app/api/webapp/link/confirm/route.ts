import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import {
  verifyWebAppToken,
  signWebAppToken,
  WebAppAuthConfigError,
} from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { linkConfirmSchema } from "@/modules/telegram-link/validation";
import { confirmLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/webapp/link/confirm — check the emailed code and link Telegram
 * (ADR 2026-10-25 §5.3). The Mini App's own Telegram account may have been
 * folded into the email account (`merged: true`) — so the answer carries a new
 * Mini App token for the TARGET account with its current session version.
 * 409 TELEGRAM_IN_USE_MERGE_REQUESTED — a merge request went to the SUPERADMIN.
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
    const parsed = linkConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join(", "),
        422
      );
    }

    const result = await confirmLink(webappUser.telegramId, parsed.data.code);

    const token = await signWebAppToken({
      sub: result.user.id,
      telegramId: result.user.telegramId,
      role: result.user.role,
      sv: result.user.sessionVersion,
    });

    return apiResponse({
      linked: result.linked,
      merged: result.merged,
      user: {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
        telegramId: result.user.telegramId,
      },
      token,
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
    console.error("[WebApp Link Confirm] Error:", error instanceof Error ? error.message : error);
    return apiServerError();
  }
}
