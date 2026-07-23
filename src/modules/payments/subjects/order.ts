import type { Payment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/modules/notifications/queue";

/**
 * Доменные эффекты платежей с subjectType=ORDER (заказы кафе).
 *
 * Сценарий QR-чекаута: клиент у кассы уже взял товар и оплачивает постфактум.
 * - Без deliveryTo (самообслуживание) → заказ сразу DELIVERED: персоналу
 *   ничего нажимать не нужно, экран «Оплачено» показывается бариста.
 * - С deliveryTo (принести в офис/беседку) → заказ остаётся NEW с paidAt,
 *   персонал ведёт его по обычной цепочке Готовить → Готово → Выдан.
 *
 * Переходы — CAS по paidAt: повторный вебхук = count 0 = no-op (леджер
 * не задваивается). Уведомления — строго после коммита, в after*-функции.
 */

type Tx = Prisma.TransactionClient;

function formatAmount(value: Prisma.Decimal | number): string {
  return Number(value.toString()).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function orderNumber(orderId: string): string {
  return orderId.slice(-6).toUpperCase();
}

export async function onOrderPaymentSucceeded(tx: Tx, payment: Payment): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: payment.subjectId } });
  if (!order) {
    await tx.systemEvent.create({
      data: {
        level: "ERROR",
        source: "payments",
        message: "Оплата получена, но заказ не найден",
        metadata: { paymentId: payment.id, orderId: payment.subjectId },
      },
    });
    return;
  }

  // Самообслуживание: неоплаченный NEW без доставки закрывается сразу.
  const autoDeliver = !order.deliveryTo && order.status === "NEW";
  const res = await tx.order.updateMany({
    where: { id: order.id, paidAt: null },
    data: {
      paidAt: payment.paidAt ?? new Date(),
      ...(autoDeliver && { status: "DELIVERED" }),
    },
  });
  if (res.count === 0) return; // повторный вебхук — эффекты уже применены

  await tx.financialTransaction.create({
    data: {
      moduleSlug: order.moduleSlug,
      type: "ONLINE_PAYMENT",
      bookingId: order.bookingId ?? null,
      totalAmount: payment.amount,
      cashAmount: 0,
      cardAmount: 0,
      performedById: "system",
      performedByName: "ЮKassa (онлайн)",
      description: payment.description,
      metadata: {
        orderId: order.id,
        paymentId: payment.id,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
      },
    },
  });
}

export async function afterOrderPaymentSucceeded(payment: Payment): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: payment.subjectId },
    include: { items: true },
  });
  if (!order) return;

  const itemsSummary = order.items
    .map((i) => `${i.name ?? "Позиция"} ×${i.quantity}`)
    .join(", ");

  enqueueNotification({
    type: "order.paid",
    moduleSlug: order.moduleSlug,
    entityId: order.id,
    userId: order.userId ?? undefined,
    actor: "admin",
    data: {
      orderNumber: orderNumber(order.id),
      amount: formatAmount(payment.amount),
      deliveryTo: order.deliveryTo,
      itemsSummary,
      orderId: order.id,
    },
  });
}

export async function onOrderPaymentCanceled(tx: Tx, payment: Payment): Promise<void> {
  // Авто-отмена брошенного QR-заказа: платёж истёк/отменён, заказ так и не
  // был оплачен и не взят в работу. Оплаченные и взятые в работу не трогаем.
  await tx.order.updateMany({
    where: { id: payment.subjectId, status: "NEW", paidAt: null },
    data: { status: "CANCELLED" },
  });
}
