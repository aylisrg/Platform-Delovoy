import type { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { isWebPushEnabled } from "@/modules/notifications/dispatch/channels/web-push/vapid";
import {
  webPushSubscribeSchema,
  webPushUnsubscribeSchema,
} from "@/modules/notifications/dispatch/channels/web-push/validation";
import {
  subscribeUser,
  unsubscribeUser,
  toPublicWebPushSubscription,
  WebPushSubscriptionConflictError,
} from "@/modules/notifications/dispatch/channels/web-push/service";

/**
 * POST /api/notifications/web-push/subscribe
 *
 * RBAC: любой авторизованный пользователь (SUPERADMIN/ADMIN/MANAGER/USER).
 *   USER в практике сюда не попадает — UI кнопки скрыт от него,
 *   но эндпоинт сам по себе не утечка: он привязывает подписку к
 *   `session.user.id`, а не к произвольному userId.
 *
 * Body: { endpoint, keys: { p256dh, auth }, userAgent? }
 * Endpoint валидируется allowlist'ом push-сервисов (защита от SSRF).
 *
 * Возвращает: { subscription: PublicWebPushSubscription }
 * Никогда не возвращает p256dh/auth.
 */
export async function POST(request: NextRequest) {
  // Под флагом WEB_PUSH_ENABLED — иначе нет смысла принимать подписки.
  if (!isWebPushEnabled()) {
    return apiError("WEB_PUSH_DISABLED", "Web Push недоступен", 503);
  }

  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated");
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = webPushSubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(
      parsed.error.issues[0]?.message ?? "invalid body",
    );
  }

  try {
    const sub = await subscribeUser(session.user.id, parsed.data);

    // Audit log — без криптоключей (только endpoint host + userAgent).
    let endpointHost: string | null = null;
    try {
      endpointHost = new URL(parsed.data.endpoint).hostname;
    } catch {
      endpointHost = null;
    }
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "notification.web-push.subscribe",
        entity: "WebPushSubscription",
        entityId: sub.id,
        metadata: {
          endpointHost,
          userAgent: parsed.data.userAgent ?? null,
        },
      },
    });

    return apiResponse({ subscription: toPublicWebPushSubscription(sub) });
  } catch (err) {
    if (err instanceof WebPushSubscriptionConflictError) {
      return apiError(
        "SUBSCRIPTION_CONFLICT",
        "Эта подписка уже привязана к другому аккаунту",
        409,
      );
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/notifications/web-push/subscribe
 *
 * RBAC: авторизованный пользователь (любой role). Может отписать только
 * СВОЮ подписку — проверка владельца внутри `unsubscribeUser`.
 *
 * Body: { endpoint }
 * Идемпотентно: если подписка не найдена / уже неактивна / принадлежит
 * другому пользователю — отвечает 200 `{ ok: true, alreadyInactive: true }`,
 * чтобы не утечь факт существования чужой подписки.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated");
  if (limited) return limited;

  // endpoint можно передать в body или в query — поддерживаем оба.
  let endpoint: string | undefined;
  const fromQuery = request.nextUrl.searchParams.get("endpoint");
  if (fromQuery) {
    endpoint = fromQuery;
  } else {
    const body = await request.json().catch(() => null);
    const parsed = webPushUnsubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(
        parsed.error.issues[0]?.message ?? "invalid body",
      );
    }
    endpoint = parsed.data.endpoint;
  }

  // Если из query — провалидируем тем же Zod (URL + длина).
  const validated = webPushUnsubscribeSchema.safeParse({ endpoint });
  if (!validated.success) {
    return apiValidationError(
      validated.error.issues[0]?.message ?? "invalid endpoint",
    );
  }

  try {
    const result = await unsubscribeUser(
      session.user.id,
      validated.data.endpoint,
    );

    // AuditLog только если что-то реально деактивировали — иначе спам.
    if (!result.alreadyInactive) {
      let endpointHost: string | null = null;
      try {
        endpointHost = new URL(validated.data.endpoint).hostname;
      } catch {
        endpointHost = null;
      }
      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          action: "notification.web-push.unsubscribe",
          entity: "WebPushSubscription",
          entityId: null,
          metadata: { endpointHost },
        },
      });
    }

    return apiResponse({ ok: true, alreadyInactive: result.alreadyInactive });
  } catch {
    return apiServerError();
  }
}
