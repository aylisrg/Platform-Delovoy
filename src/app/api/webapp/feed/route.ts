import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { feedQuerySchema } from "@/lib/webapp/validation";
import { getWebappFeed } from "@/modules/notifications/feed";

/**
 * GET /api/webapp/feed — лента Mini App (ADR §3.1).
 * Роли: любая аутентифицированная (USER включительно).
 *
 * Выборка строго по `userId` из проверенного токена — id из query не читается.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    // Лимит после верификации токена — ключ по пользователю, а не по IP:
    // мобильные операторы РФ сидят за CGNAT (ADR §2).
    const limited = await rateLimit(request, "authenticated", user.id);
    if (limited) return limited;

    const params = request.nextUrl.searchParams;
    const parsed = feedQuerySchema.safeParse({
      limit: params.get("limit") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
    });
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Некорректные параметры запроса",
        422
      );
    }

    const page = await getWebappFeed(user.id, parsed.data);
    return apiResponse(page);
  } catch (error) {
    console.error("[WebApp API] Feed error:", error);
    return apiServerError();
  }
}
