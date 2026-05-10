import type { WebPushSubscription } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WebPushSubscribeInput } from "./validation";

/**
 * Безопасный DTO — в API/UI отдаём только метаданные подписки,
 * криптоключи (p256dh, auth) никогда не утекают за пределы сервера.
 */
export type PublicWebPushSubscription = {
  id: string;
  userId: string;
  endpoint: string;
  userAgent: string | null;
  isActive: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toPublicWebPushSubscription(
  sub: WebPushSubscription,
): PublicWebPushSubscription {
  return {
    id: sub.id,
    userId: sub.userId,
    endpoint: sub.endpoint,
    userAgent: sub.userAgent,
    isActive: sub.isActive,
    lastSuccessAt: sub.lastSuccessAt,
    lastFailureAt: sub.lastFailureAt,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

/**
 * Деактивировать подписку по endpoint — используется каналом при 410/404 ответах
 * push-сервиса и при VAPID mismatch (401/403). Транзакционно гасит и UNC.
 *
 * Возвращает true если запись существовала и была обновлена, false — если
 * подписки нет (например, уже удалена параллельным запросом).
 */
export async function deactivateSubscriptionByEndpoint(
  endpoint: string,
  reason: string,
): Promise<boolean> {
  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint },
    select: { id: true, userNotificationChannelId: true },
  });
  if (!existing) return false;

  await prisma.$transaction(async (tx) => {
    await tx.webPushSubscription.update({
      where: { endpoint },
      data: {
        isActive: false,
        lastFailureAt: new Date(),
        lastFailureReason: reason,
      },
    });
    if (existing.userNotificationChannelId) {
      await tx.userNotificationChannel.update({
        where: { id: existing.userNotificationChannelId },
        data: { isActive: false },
      });
    }
  });
  return true;
}

/**
 * Подписать пользователя на Web Push.
 *
 * Логика:
 * - Если по `endpoint` уже есть подписка этого же пользователя — реактивирует
 *   её (isActive=true), обновляет p256dh/auth/userAgent и сбрасывает
 *   `lastFailureReason`. UNC того же endpoint тоже реактивируется.
 * - Если подписки не было — создаёт новые `UserNotificationChannel(kind=PUSH)`
 *   и `WebPushSubscription` в одной транзакции. `priority` UNC = max существующих
 *   PUSH-приоритетов пользователя + 1, иначе 100 (если первый).
 *
 * Если подписка с таким endpoint принадлежит ДРУГОМУ пользователю — бросает
 * `WebPushSubscriptionConflictError` (защищает от перехвата чужой подписки).
 *
 * Возвращает актуальную (после upsert'a) запись `WebPushSubscription`.
 */
export class WebPushSubscriptionConflictError extends Error {
  constructor(message = "subscription endpoint belongs to another user") {
    super(message);
    this.name = "WebPushSubscriptionConflictError";
  }
}

export async function subscribeUser(
  userId: string,
  input: WebPushSubscribeInput,
): Promise<WebPushSubscription> {
  const { endpoint, keys, userAgent } = input;

  // Защита: если endpoint принадлежит другому пользователю — конфликт.
  // Push endpoint выдаётся браузером и теоретически уникален per-device,
  // но если злоумышленник как-то получил чужой endpoint и пытается
  // привязать его к своему аккаунту — отказываем.
  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) {
    throw new WebPushSubscriptionConflictError();
  }

  return prisma.$transaction(async (tx) => {
    // Считаем priority: max существующих PUSH-каналов пользователя + 1, иначе 100.
    const aggr = await tx.userNotificationChannel.aggregate({
      where: { userId, kind: "PUSH" },
      _max: { priority: true },
    });
    const nextPriority =
      typeof aggr._max.priority === "number" ? aggr._max.priority + 1 : 100;

    // Upsert UNC по композитному (userId, kind, address).
    const unc = await tx.userNotificationChannel.upsert({
      where: {
        userId_kind_address: { userId, kind: "PUSH", address: endpoint },
      },
      create: {
        userId,
        kind: "PUSH",
        address: endpoint,
        label: userAgent ?? null,
        priority: nextPriority,
        isActive: true,
      },
      update: {
        // Реактивация: ставим isActive=true, обновляем label на свежий userAgent.
        // priority сохраняем существующий — пользователь мог его перенастроить.
        isActive: true,
        ...(userAgent ? { label: userAgent } : {}),
      },
    });

    // Upsert WebPushSubscription.
    const sub = await tx.webPushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        userNotificationChannelId: unc.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
        isActive: true,
      },
      update: {
        // Реактивация существующей подписки этого же пользователя.
        // Обновляем ключи (браузер мог их перевыпустить).
        userNotificationChannelId: unc.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        ...(userAgent ? { userAgent } : {}),
        isActive: true,
        lastFailureReason: null,
      },
    });

    return sub;
  });
}

/**
 * Отписать пользователя от Web Push по endpoint.
 *
 * Идемпотентно: если подписки нет или она уже неактивна — возвращает
 * `{ alreadyInactive: true }`, никаких ошибок. Если подписка принадлежит
 * другому пользователю — также возвращает `{ alreadyInactive: true }`
 * (а не 404), чтобы не утечь сам факт существования чужой подписки.
 *
 * Технически опирается на существующую `deactivateSubscriptionByEndpoint`,
 * но добавляет проверку владельца ДО деактивации.
 */
export async function unsubscribeUser(
  userId: string,
  endpoint: string,
): Promise<{ alreadyInactive: boolean }> {
  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint },
    select: { userId: true, isActive: true },
  });
  if (!existing || existing.userId !== userId || !existing.isActive) {
    // Не существует, чужая или уже неактивна — идемпотентный no-op.
    return { alreadyInactive: true };
  }

  const did = await deactivateSubscriptionByEndpoint(
    endpoint,
    "user requested unsubscribe",
  );
  return { alreadyInactive: !did };
}

/**
 * Зафиксировать успешную доставку — сбрасывает счётчики ошибок,
 * пишет lastSuccessAt. Не падает, если подписка успела быть удалена.
 */
export async function recordSuccessfulDelivery(endpoint: string): Promise<void> {
  await prisma.webPushSubscription
    .update({
      where: { endpoint },
      data: { lastSuccessAt: new Date() },
    })
    .catch(() => {
      // Race: подписка удалена между send() и update — это OK, доставка прошла.
    });
}
