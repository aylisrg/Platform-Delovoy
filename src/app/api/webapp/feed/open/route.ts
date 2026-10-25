import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { feedOpenSchema } from "@/lib/webapp/validation";
import { openFeedItem } from "@/modules/notifications/feed";

/**
 * POST /api/webapp/feed/open — тап по карточке ленты: прочтение + переход
 * как одна реакция (AC-D3.10, ADR 2026-10-25 §Q4). Лента не ходит через
 * трекинг-редирект `/r`: навигация остаётся по исходному URL, этот вызов —
 * fire-and-forget. Как и `feed/read`, без AuditLog (персональное состояние UI);
 * чужие строки недостижимы — сервис пишет строго с `where.userId` из токена.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await verifyWebAppToken(request);
    if (!user) {
      return apiError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const limited = await rateLimit(request, "authenticated", user.id);
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
    const parsed = feedOpenSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Некорректное тело запроса",
        422
      );
    }

    return apiResponse(await openFeedItem(user.id, parsed.data));
  } catch (error) {
    console.error("[WebApp API] Feed open error:", error);
    return apiServerError();
  }
}
