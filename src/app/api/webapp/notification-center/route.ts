import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import {
  loadWebAppStaff,
  verifyWebAppToken,
  type WebAppStaffContext,
} from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/logger";
import {
  CenterError,
  getNotificationCenter,
  setEventPreference,
} from "@/modules/notifications/webapp-center";
import { notificationCenterUpdateSchema } from "@/modules/notifications/validation";

/**
 * Центр уведомлений сотрудника — `GET`/`PUT /api/webapp/notification-center`
 * (ADR `2026-08-13-miniapp-role-rebuild` §3.3).
 *
 * Роли: MANAGER | ADMIN | SUPERADMIN. Роль и секции перечитываются из БД на
 * каждый запрос (`loadWebAppStaff`), роль из токена в решении не участвует —
 * понижение лишает доступа немедленно (AC-1.5/AC-5.8).
 */

type StaffGuard =
  | { ok: true; staff: WebAppStaffContext; telegramId: string }
  | { ok: false; response: ReturnType<typeof apiError> };

/**
 * Порядок обязателен (review 2026-08-13, MAJOR-2): rate limit ДО похода в БД
 * за ролью/секциями. Иначе 401/403-пути (в т.ч. массовая роль USER) обходят
 * лимит, а каждый их запрос стоит запросов в БД. Без валидного токена
 * лимитируем по IP публичным тиром, с токеном — по userId до ре-чека роли.
 */
async function requireStaff(request: NextRequest): Promise<StaffGuard> {
  const tokenUser = await verifyWebAppToken(request);
  if (!tokenUser) {
    const limited = await rateLimit(request, "public");
    if (limited) return { ok: false, response: limited };
    return {
      ok: false,
      response: apiError("UNAUTHORIZED", "Invalid or expired token", 401),
    };
  }

  const limited = await rateLimit(request, "authenticated", tokenUser.id);
  if (limited) return { ok: false, response: limited };

  const auth = await loadWebAppStaff(request);
  if (!auth.ok) {
    return {
      ok: false,
      response:
        auth.status === 401
          ? apiError("UNAUTHORIZED", "Invalid or expired token", 401)
          : apiError("FORBIDDEN", "Раздел доступен только сотрудникам", 403),
    };
  }
  // Адрес канала берётся из подписанного нами токена (туда он попал из
  // проверенного initData), а не из тела запроса — клиент назначить чужой
  // Telegram-адрес не может.
  return { ok: true, staff: auth.staff, telegramId: tokenUser.telegramId };
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requireStaff(request);
    if (!guard.ok) return guard.response;

    const data = await getNotificationCenter(guard.staff, guard.telegramId);
    return apiResponse(data);
  } catch (error) {
    console.error("[WebApp API] Notification center error:", error);
    return apiServerError();
  }
}

export async function PUT(request: NextRequest) {
  try {
    const guard = await requireStaff(request);
    if (!guard.ok) return guard.response;

    const body: unknown = await request.json().catch(() => null);
    const parsed = notificationCenterUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "Некорректные данные", 422);
    }

    const result = await setEventPreference(
      guard.staff,
      parsed.data.eventType,
      parsed.data.enabled
    );

    await logAudit(
      guard.staff.id,
      "notification.preference.update",
      "NotificationEventPreference",
      result.eventType,
      { enabled: result.enabled, source: "webapp" }
    );

    return apiResponse(result);
  } catch (error) {
    if (error instanceof CenterError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error("[WebApp API] Notification center update error:", error);
    return apiServerError();
  }
}
