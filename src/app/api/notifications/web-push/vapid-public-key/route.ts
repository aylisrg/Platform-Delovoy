import type { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { isWebPushEnabled } from "@/modules/notifications/dispatch/channels/web-push/vapid";

/**
 * GET /api/notifications/web-push/vapid-public-key
 *
 * Public endpoint — VAPID public key и так публичен по дизайну
 * (RFC 8292: applicationServerKey передаётся в браузер для
 * `pushManager.subscribe()`). Аутентификация не требуется, но
 * стоит rate-limit для защиты от спама.
 *
 * Возвращает 503 если фича выключена (`WEB_PUSH_ENABLED !== "true"`)
 * или ключи не сконфигурированы — клиент должен трактовать это как
 * "Web Push недоступен" и скрыть UI подписки.
 */
export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, "public");
  if (limited) return limited;

  if (!isWebPushEnabled()) {
    return apiError(
      "WEB_PUSH_DISABLED",
      "Web Push недоступен",
      503,
    );
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    // isWebPushEnabled проверяет VAPID_PUBLIC_KEY (server-side) —
    // публичный должен быть тем же значением, но если админ забыл
    // продублировать — возвращаем 503.
    return apiError(
      "WEB_PUSH_DISABLED",
      "VAPID public key не сконфигурирован",
      503,
    );
  }

  return apiResponse({ publicKey });
}
