import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { feedReadSchema } from "@/lib/webapp/validation";
import { markFeedRead } from "@/modules/notifications/feed";

/**
 * POST /api/webapp/feed/read — отметить ленту прочитанной (ADR §3.1).
 * Body: `{ ids: ["on:clx1"] }` и/или `{ upTo: "2026-08-13T09:00:00.000Z" }`.
 *
 * `AuditLog` здесь сознательно не пишется (ADR §12): отметка о прочтении —
 * персональное состояние UI, а не бизнес-мутация; аудит на каждый скролл
 * ленты только зашумил бы журнал. Чужие строки недостижимы: сервис пишет
 * строго с `where.userId` из проверенного токена.
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
    const parsed = feedReadSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Некорректное тело запроса",
        422
      );
    }

    const result = await markFeedRead(user.id, parsed.data);
    return apiResponse(result);
  } catch (error) {
    console.error("[WebApp API] Feed read error:", error);
    return apiServerError();
  }
}
