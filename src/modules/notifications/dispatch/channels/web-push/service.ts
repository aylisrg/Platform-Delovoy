import type { WebPushSubscription } from "@prisma/client";
import { prisma } from "@/lib/db";

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
