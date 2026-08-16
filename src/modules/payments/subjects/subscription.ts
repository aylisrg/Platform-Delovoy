import type { Payment, Prisma } from "@prisma/client";
import { EVENT_SOURCES } from "@/lib/event-sources";

/**
 * Доменные эффекты платежей с subjectType=SUBSCRIPTION (абонементы PS Park).
 *
 * Пасс, проданный онлайн, создаётся в статусе PENDING_PAYMENT и активируется
 * здесь после подтверждения оплаты. Ручная продажа (наличные на стойке)
 * по-прежнему создаёт пасс сразу ACTIVE — этот код её не касается.
 */

type Tx = Prisma.TransactionClient;

export async function onSubscriptionPaymentSucceeded(tx: Tx, payment: Payment): Promise<void> {
  const sub = await tx.subscription.findUnique({ where: { id: payment.subjectId } });
  if (!sub) {
    // eslint-disable-next-line no-restricted-syntax -- атомарная запись внутри $transaction, logger.ts вне её недопустим
    await tx.systemEvent.create({
      data: {
        level: "ERROR",
        source: EVENT_SOURCES.PAYMENTS,
        message: "Оплата получена, но абонемент не найден",
        metadata: { paymentId: payment.id, subscriptionId: payment.subjectId },
      },
    });
    return;
  }
  if (sub.status !== "PENDING_PAYMENT") return; // уже активирован (в т.ч. вручную)

  // Партиал-unique «один ACTIVE на userId»: активация при существующем ACTIVE
  // упала бы и откатила всю транзакцию (платёж остался бы PENDING при списанных
  // деньгах). Пре-чек + CRITICAL — решение принимает SUPERADMIN (возврат вручную).
  const existingActive = await tx.subscription.findFirst({
    where: { userId: sub.userId, status: "ACTIVE" },
    select: { id: true },
  });
  if (existingActive) {
    // eslint-disable-next-line no-restricted-syntax -- атомарная запись внутри $transaction, logger.ts вне её недопустим
    await tx.systemEvent.create({
      data: {
        level: "CRITICAL",
        source: EVENT_SOURCES.PAYMENTS,
        message:
          "Оплата абонемента получена, но активация невозможна: у гостя уже есть активный абонемент. Требуется ручное решение (возврат).",
        metadata: {
          paymentId: payment.id,
          subscriptionId: sub.id,
          existingSubscriptionId: existingActive.id,
          userId: sub.userId,
        },
      },
    });
    return;
  }

  await tx.subscription.updateMany({
    where: { id: sub.id, status: "PENDING_PAYMENT" },
    data: { status: "ACTIVE" },
  });

  await tx.subscriptionTransaction.create({
    data: {
      subscriptionId: sub.id,
      type: "MANUAL_TOPUP",
      hoursDelta: sub.totalHours,
      balanceAfter: sub.totalHours,
      reason: "online purchase",
      performedById: "system",
      performedByName: "ЮKassa (онлайн)",
    },
  });

  await tx.financialTransaction.create({
    data: {
      moduleSlug: sub.moduleSlug,
      type: "ONLINE_PAYMENT",
      totalAmount: payment.amount,
      cashAmount: 0,
      cardAmount: 0,
      performedById: "system",
      performedByName: "ЮKassa (онлайн)",
      description: payment.description,
      metadata: {
        paymentId: payment.id,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        subscriptionId: sub.id,
      },
    },
  });
}

export async function onSubscriptionPaymentCanceled(tx: Tx, payment: Payment): Promise<void> {
  const sub = await tx.subscription.findUnique({ where: { id: payment.subjectId } });
  if (!sub || sub.status !== "PENDING_PAYMENT") return;

  await tx.subscription.updateMany({
    where: { id: sub.id, status: "PENDING_PAYMENT" },
    data: {
      status: "CANCELLED",
      cancelReason: "Оплата не завершена",
      cancelledAt: new Date(),
      cancelledById: "system",
    },
  });
}
