import { prisma } from "@/lib/db";
import type { Payment, Prisma } from "@prisma/client";
import { log, logAudit } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import {
  createPayment as yooCreatePayment,
  getPayment as yooGetPayment,
  createRefund as yooCreateRefund,
  isYooKassaConfigured,
  newIdempotenceKey,
  toAmountValue,
  YooKassaError,
} from "@/lib/yookassa/client";
import { buildReceipt, ReceiptContactError, type ReceiptItemInput } from "@/lib/yookassa/receipts";
import type { YooPayment } from "@/lib/yookassa/types";
import { enqueueNotification } from "@/modules/notifications/queue";
import {
  PaymentError,
  type AutoRefundResult,
  type AutoRefundTrigger,
  type BookingPaymentDetail,
  type BookingPaymentStatus,
  type BookingPaymentSummary,
  type CreateOnlinePaymentInput,
  type PublicPaymentStatus,
  type ReconcileReport,
  type RefundInput,
} from "./types";

/**
 * Модуль payments — бизнес-логика онлайн-оплаты (провайдер: ЮKassa).
 * План: docs/architecture/2026-07-08-yookassa-integration-plan.md,
 * PRD: docs/requirements/2026-07-09-payments-module-prd.md.
 *
 * Принципы:
 * - Источник истины по статусу — API провайдера: вебхук и reconciliation
 *   делают re-fetch платежа и только потом применяют переход.
 * - Переходы статусов — compare-and-swap (updateMany с where по статусу):
 *   повторный вебхук/гонка = no-op.
 * - Доменные эффекты (подтверждение брони, активация абонемента, леджер)
 *   выполняются в ОДНОЙ транзакции с переходом статуса.
 */

const MODULE_SLUG = EVENT_SOURCES.PAYMENTS;

/** Окно оплаты pending-платежа ЮKassa ~1 час; наш TTL совпадает. */
const PENDING_TTL_MINUTES = 60;

/** Политика возвратов (решение владельца): полный возврат при отмене гостем
 *  более чем за N часов до начала; позже — без возврата. */
export const CLIENT_REFUND_THRESHOLD_HOURS = 24;

const NON_FINAL_STATUSES = ["PENDING", "WAITING_FOR_CAPTURE"] as const;

function decimalToNumber(value: Prisma.Decimal | number): number {
  return Number(value.toString());
}

function formatAmount(value: Prisma.Decimal | number): string {
  return decimalToNumber(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// === Создание платежа ===

export async function createOnlinePayment(input: CreateOnlinePaymentInput): Promise<Payment> {
  if (!isYooKassaConfigured()) {
    throw new PaymentError(
      "PAYMENTS_NOT_CONFIGURED",
      "Онлайн-оплата временно недоступна"
    );
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new PaymentError("INVALID_AMOUNT", "Сумма платежа должна быть больше нуля");
  }

  let receipt;
  try {
    receipt = buildReceipt(
      { email: input.customerEmail, phone: input.customerPhone },
      input.receiptItems
    );
  } catch (err) {
    if (err instanceof ReceiptContactError) {
      throw new PaymentError(err.code, err.message);
    }
    throw err;
  }

  // Idempotence-Key сохраняется ДО запроса: ретрай после 5xx/сети пойдёт
  // с тем же ключом и не создаст второй платёж у провайдера.
  const idempotenceKey = newIdempotenceKey();
  const payment = await prisma.payment.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      moduleSlug: input.moduleSlug,
      amount: input.amount,
      description: input.description.slice(0, 128),
      userId: input.userId ?? null,
      createdById: input.createdById ?? null,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone ?? null,
      idempotenceKey,
      expiresAt: new Date(Date.now() + PENDING_TTL_MINUTES * 60_000),
      metadata: {
        ...(input.metadata ?? {}),
        receiptItems: input.receiptItems.map((item) => ({
          description: item.description,
          amount: toAmountValue(item.amount),
          quantity: item.quantity ?? 1,
          paymentMode: item.paymentMode ?? "full_payment",
          paymentSubject: item.paymentSubject ?? "service",
        })),
      } as Prisma.InputJsonValue,
    },
  });

  // Плейсхолдер {paymentId} в returnUrl подставляется после создания строки —
  // страница ожидания оплаты адресуется нашим id платежа.
  const returnUrl = input.returnUrl.replace("{paymentId}", payment.id);

  let remote: YooPayment;
  try {
    remote = await yooCreatePayment(
      {
        amount: { value: toAmountValue(input.amount), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: returnUrl },
        description: input.description.slice(0, 128),
        metadata: {
          paymentId: payment.id,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
        ...(receipt && { receipt }),
        ...(input.userId && { merchant_customer_id: input.userId }),
      },
      idempotenceKey
    );
  } catch (err) {
    const reason = err instanceof YooKassaError ? `create_failed: ${err.code}` : "create_failed";
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "CANCELED", cancellationReason: reason },
    });
    await log.error(MODULE_SLUG, "Не удалось создать платёж в ЮKassa", {
      paymentId: payment.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PaymentError(
      "PAYMENT_CREATE_FAILED",
      "Не удалось создать платёж. Попробуйте позже."
    );
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerPaymentId: remote.id,
      confirmationUrl: remote.confirmation?.confirmation_url ?? null,
      isTest: remote.test ?? false,
    },
  });

  await logAudit(
    input.createdById ?? input.userId ?? "system",
    "payment.create",
    "Payment",
    payment.id,
    {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      moduleSlug: input.moduleSlug,
      amount: toAmountValue(input.amount),
      providerPaymentId: remote.id,
    }
  );

  return updated;
}

// === Синхронизация состояния с провайдером ===

/** Вебхук: по providerPaymentId делаем re-fetch и применяем актуальный статус. */
export async function syncPaymentByProviderId(providerPaymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { providerPaymentId } });
  if (!payment) {
    await log.warn(MODULE_SLUG, "Вебхук по неизвестному платежу", { providerPaymentId });
    return;
  }
  const remote = await yooGetPayment(providerPaymentId);
  await applyProviderState(payment.id, remote);
}

async function applyProviderState(paymentId: string, remote: YooPayment): Promise<void> {
  switch (remote.status) {
    case "succeeded":
      await markSucceeded(paymentId, remote);
      return;
    case "canceled":
      await markCanceled(paymentId, remote.cancellation_details?.reason ?? "canceled");
      return;
    case "waiting_for_capture":
      await prisma.payment.updateMany({
        where: { id: paymentId, status: "PENDING" },
        data: { status: "WAITING_FOR_CAPTURE" },
      });
      return;
    case "pending":
      return; // ждём дальше
  }
}

async function applySubjectEffectsOnSuccess(
  tx: Prisma.TransactionClient,
  payment: Payment
): Promise<void> {
  switch (payment.subjectType) {
    case "BOOKING": {
      const { onBookingPaymentSucceeded } = await import("./subjects/booking");
      await onBookingPaymentSucceeded(tx, payment);
      return;
    }
    case "SUBSCRIPTION": {
      const { onSubscriptionPaymentSucceeded } = await import("./subjects/subscription");
      await onSubscriptionPaymentSucceeded(tx, payment);
      return;
    }
    case "ORDER": {
      const { onOrderPaymentSucceeded } = await import("./subjects/order");
      await onOrderPaymentSucceeded(tx, payment);
      return;
    }
    default:
      // eslint-disable-next-line no-restricted-syntax -- атомарная запись внутри $transaction, logger.ts вне её недопустим
      await tx.systemEvent.create({
        data: {
          level: "ERROR",
          source: MODULE_SLUG,
          message: `Оплата получена для нереализованного subjectType: ${payment.subjectType}`,
          metadata: { paymentId: payment.id },
        },
      });
  }
}

async function applySubjectEffectsOnCancel(
  tx: Prisma.TransactionClient,
  payment: Payment
): Promise<void> {
  switch (payment.subjectType) {
    case "BOOKING": {
      const { onBookingPaymentCanceled } = await import("./subjects/booking");
      await onBookingPaymentCanceled(tx, payment);
      return;
    }
    case "SUBSCRIPTION": {
      const { onSubscriptionPaymentCanceled } = await import("./subjects/subscription");
      await onSubscriptionPaymentCanceled(tx, payment);
      return;
    }
    case "ORDER": {
      const { onOrderPaymentCanceled } = await import("./subjects/order");
      await onOrderPaymentCanceled(tx, payment);
      return;
    }
    default:
      return;
  }
}

async function markSucceeded(paymentId: string, remote: YooPayment): Promise<void> {
  const applied = await prisma.$transaction(async (tx) => {
    // CAS: только из нефинального статуса. Повторный вебхук = count 0 = no-op.
    const res = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: [...NON_FINAL_STATUSES] } },
      data: {
        status: "SUCCEEDED",
        paidAt: remote.captured_at ? new Date(remote.captured_at) : new Date(),
        paymentMethodType: remote.payment_method?.type ?? null,
        isTest: remote.test ?? false,
      },
    });
    if (res.count === 0) return null;

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await applySubjectEffectsOnSuccess(tx, payment);

    await tx.auditLog.create({
      data: {
        userId: payment.userId ?? "system",
        action: "payment.succeeded",
        entity: "Payment",
        entityId: payment.id,
        metadata: {
          subjectType: payment.subjectType,
          subjectId: payment.subjectId,
          amount: payment.amount.toString(),
          paymentMethodType: remote.payment_method?.type ?? null,
        },
      },
    });

    return payment;
  });

  if (!applied) return;

  enqueueNotification({
    type: "payment.succeeded",
    moduleSlug: applied.moduleSlug,
    entityId: applied.id,
    userId: applied.userId ?? undefined,
    data: { amount: formatAmount(applied.amount), description: applied.description },
  });

  if (applied.subjectType === "BOOKING") {
    const { afterBookingPaymentSucceeded } = await import("./subjects/booking");
    await afterBookingPaymentSucceeded(applied);
  }
  if (applied.subjectType === "ORDER") {
    const { afterOrderPaymentSucceeded } = await import("./subjects/order");
    await afterOrderPaymentSucceeded(applied);
  }
}

async function markCanceled(paymentId: string, reason: string): Promise<void> {
  const applied = await prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: [...NON_FINAL_STATUSES] } },
      data: { status: "CANCELED", cancellationReason: reason },
    });
    if (res.count === 0) return null;

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await applySubjectEffectsOnCancel(tx, payment);
    return payment;
  });

  if (!applied) return;

  enqueueNotification({
    type: "payment.canceled",
    moduleSlug: applied.moduleSlug,
    entityId: applied.id,
    userId: applied.userId ?? undefined,
    data: {
      amount: formatAmount(applied.amount),
      description: applied.description,
      reason,
    },
  });

  if (applied.subjectType === "BOOKING") {
    const { afterBookingPaymentCanceled } = await import("./subjects/booking");
    await afterBookingPaymentCanceled(applied);
  }
}

// === Возвраты ===

/**
 * Полный возврат остатка платежа (решение владельца: возвраты всегда полные;
 * частичные суммы доступны только на уровне сервиса, в UI не выносятся).
 */
export async function refundPayment(paymentId: string, input: RefundInput): Promise<string> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    throw new PaymentError("PAYMENT_NOT_FOUND", "Платёж не найден");
  }
  if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") {
    throw new PaymentError(
      "REFUND_NOT_ALLOWED",
      "Возврат возможен только для успешно оплаченного платежа"
    );
  }
  if (!payment.providerPaymentId) {
    throw new PaymentError("REFUND_NOT_ALLOWED", "У платежа нет идентификатора провайдера");
  }

  const remaining = decimalToNumber(payment.amount) - decimalToNumber(payment.refundedAmount);
  if (remaining <= 0) {
    throw new PaymentError("ALREADY_REFUNDED", "Платёж уже полностью возвращён");
  }

  // Чек возврата — из снапшота позиций, сохранённого при создании платежа.
  const meta = (payment.metadata as Record<string, unknown> | null) ?? {};
  const snapshotItems = (meta.receiptItems ?? []) as Array<{
    description: string;
    amount: string;
    quantity: number;
    paymentSubject?: "service" | "commodity";
  }>;
  const receiptItems: ReceiptItemInput[] =
    snapshotItems.length > 0
      ? snapshotItems.map((item) => ({
          description: item.description,
          amount: item.amount,
          quantity: item.quantity,
          paymentSubject: item.paymentSubject,
        }))
      : [{ description: payment.description, amount: remaining }];
  const receipt = buildReceipt(
    { email: payment.customerEmail, phone: payment.customerPhone },
    receiptItems
  );

  const idempotenceKey = newIdempotenceKey();
  const refundRow = await prisma.paymentRefund.create({
    data: {
      paymentId: payment.id,
      idempotenceKey,
      amount: remaining,
      reason: input.reason,
      createdById: input.performedById,
    },
  });

  let remoteStatus: string;
  let providerRefundId: string;
  try {
    const remote = await yooCreateRefund(
      {
        payment_id: payment.providerPaymentId,
        amount: { value: toAmountValue(remaining), currency: "RUB" },
        description: input.reason.slice(0, 250),
        ...(receipt && { receipt }),
      },
      idempotenceKey
    );
    remoteStatus = remote.status;
    providerRefundId = remote.id;
  } catch (err) {
    await prisma.paymentRefund.update({
      where: { id: refundRow.id },
      data: { status: "canceled" },
    });
    if (err instanceof YooKassaError && err.code === "insufficient_funds") {
      await log.warn(MODULE_SLUG, "Возврат отклонён: недостаточно средств на балансе магазина", {
        paymentId: payment.id,
      });
      throw new PaymentError(
        "REFUND_INSUFFICIENT_FUNDS",
        "На балансе магазина ЮKassa недостаточно средств для возврата. Попробуйте позже."
      );
    }
    await log.error(MODULE_SLUG, "Возврат не создан", {
      paymentId: payment.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PaymentError("REFUND_FAILED", "Не удалось оформить возврат. Попробуйте позже.");
  }

  await prisma.paymentRefund.update({
    where: { id: refundRow.id },
    data: { providerRefundId },
  });

  await logAudit(input.performedById, "payment.refund", "Payment", payment.id, {
    refundId: refundRow.id,
    providerRefundId,
    amount: toAmountValue(remaining),
    reason: input.reason,
    performedByName: input.performedByName,
  });

  if (remoteStatus === "succeeded") {
    await finalizeRefund(refundRow.id);
  }

  return refundRow.id;
}

/**
 * Финализация возврата: инкремент refundedAmount, статус платежа, леджер,
 * уведомление. Идемпотентна (CAS pending → succeeded) — вызывается и сразу
 * после createRefund, и из вебхука refund.succeeded.
 */
export async function finalizeRefund(refundId: string): Promise<void> {
  const applied = await prisma.$transaction(async (tx) => {
    const res = await tx.paymentRefund.updateMany({
      where: { id: refundId, status: "pending" },
      data: { status: "succeeded" },
    });
    if (res.count === 0) return null;

    const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refundId } });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });

    const newRefunded = decimalToNumber(payment.refundedAmount) + decimalToNumber(refund.amount);
    const fullyRefunded = newRefunded >= decimalToNumber(payment.amount) - 0.005;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: newRefunded,
        status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });

    // Леджер: возвраты со знаком минус — SUM(totalAmount) остаётся честной выручкой.
    await tx.financialTransaction.create({
      data: {
        moduleSlug: payment.moduleSlug,
        type: "REFUND",
        bookingId: payment.subjectType === "BOOKING" ? payment.subjectId : null,
        totalAmount: -decimalToNumber(refund.amount),
        cashAmount: 0,
        cardAmount: 0,
        performedById: refund.createdById,
        performedByName: "Возврат (ЮKassa)",
        description: `Возврат: ${payment.description}`,
        metadata: {
          paymentId: payment.id,
          refundId: refund.id,
          providerRefundId: refund.providerRefundId,
          reason: refund.reason,
        },
      },
    });

    return { refund, payment };
  });

  if (!applied) return;

  enqueueNotification({
    type: "payment.refund.succeeded",
    moduleSlug: applied.payment.moduleSlug,
    entityId: applied.payment.id,
    userId: applied.payment.userId ?? undefined,
    data: {
      amount: formatAmount(applied.refund.amount),
      description: applied.payment.description,
    },
  });
}

/** Вебхук refund.succeeded: находим локальный возврат и финализируем. */
export async function syncRefundByProviderId(providerRefundId: string): Promise<void> {
  const refund = await prisma.paymentRefund.findUnique({ where: { providerRefundId } });
  if (!refund) {
    await log.warn(MODULE_SLUG, "Вебхук по неизвестному возврату", { providerRefundId });
    return;
  }
  await finalizeRefund(refund.id);
}

/**
 * Автовозврат по политике отмены (решение владельца):
 * - отмена гостем > 24 ч до начала → полный возврат;
 * - отмена гостем ≤ 24 ч → без возврата;
 * - отмена парком/менеджером → полный возврат всегда.
 * Ошибка возврата НЕ блокирует отмену — логируется для ручного разбора.
 */
export async function autoRefundOnCancellation(params: {
  subjectType: Payment["subjectType"];
  subjectId: string;
  trigger: AutoRefundTrigger;
  eventStartTime?: Date;
}): Promise<AutoRefundResult> {
  if (params.trigger === "client_cancellation") {
    const startTime = params.eventStartTime;
    const hoursUntilStart = startTime
      ? (startTime.getTime() - Date.now()) / 3_600_000
      : 0;
    if (hoursUntilStart <= CLIENT_REFUND_THRESHOLD_HOURS) {
      return { refunded: false, reason: "within_24h" };
    }
  }

  const payment = await prisma.payment.findFirst({
    where: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) return { refunded: false, reason: "no_payment" };

  try {
    const refundId = await refundPayment(payment.id, {
      reason:
        params.trigger === "park_cancellation"
          ? "Автовозврат: отмена парком"
          : "Автовозврат: отмена гостем более чем за 24 часа",
      performedById: "system",
      performedByName: "Система (политика отмены)",
    });
    return { refunded: true, refundId, amount: payment.amount.toString() };
  } catch (err) {
    await log.error(MODULE_SLUG, "Автовозврат не выполнен — требуется ручной разбор", {
      paymentId: payment.id,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      trigger: params.trigger,
      error: err instanceof Error ? err.message : String(err),
    });
    return { refunded: false, reason: "refund_failed" };
  }
}

// === Reconciliation (страховка от потери вебхука) ===

export async function reconcilePayments(): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, transitioned: 0, expired: 0, errors: 0 };

  const stale = await prisma.payment.findMany({
    where: {
      status: { in: [...NON_FINAL_STATUSES] },
      updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  for (const payment of stale) {
    report.checked += 1;

    // Платёж без providerPaymentId — создание оборвалось между insert и API.
    if (!payment.providerPaymentId) {
      if (payment.createdAt < new Date(Date.now() - PENDING_TTL_MINUTES * 60_000)) {
        await markCanceled(payment.id, "create_incomplete");
        report.expired += 1;
      }
      continue;
    }

    try {
      const remote = await yooGetPayment(payment.providerPaymentId);
      const before = payment.status;
      await applyProviderState(payment.id, remote);
      const after = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { status: true },
      });
      if (after && after.status !== before) report.transitioned += 1;
    } catch (err) {
      if (err instanceof YooKassaError && err.httpStatus === 404) {
        await markCanceled(payment.id, "not_found_at_provider");
        report.expired += 1;
        continue;
      }
      report.errors += 1;
      await log.warn(MODULE_SLUG, "Reconciliation: платёж не сверён", {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

// === Чтение ===

export async function listPayments(query: {
  status?: Payment["status"];
  moduleSlug?: string;
  page: number;
  perPage: number;
}) {
  const where = {
    ...(query.status && { status: query.status }),
    ...(query.moduleSlug && { moduleSlug: query.moduleSlug }),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { refunds: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, total };
}

// === Статус оплаты по броням (для админ-списков и страницы брони) ===

/**
 * Свод набора платежей одной брони в компактный статус.
 * У ps-park на одну бронь может быть несколько платежей (частичная оплата
 * счёта), поэтому агрегируем по всему набору, а не берём последний.
 */
function derivePaymentStatus(payments: Payment[]): BookingPaymentStatus {
  if (payments.length === 0) return "NONE";
  const hasSucceeded = payments.some((p) => p.status === "SUCCEEDED");
  const hasPartial = payments.some((p) => p.status === "PARTIALLY_REFUNDED");
  const hasRefunded = payments.some((p) => p.status === "REFUNDED");
  const hasPending = payments.some(
    (p) => p.status === "PENDING" || p.status === "WAITING_FOR_CAPTURE"
  );

  if (hasRefunded && !hasSucceeded && !hasPartial) return "REFUNDED";
  if (hasPartial || (hasRefunded && hasSucceeded)) return "PARTIALLY_REFUNDED";
  if (hasSucceeded) return "PAID";
  if (hasPending) return "AWAITING";
  return "FAILED"; // остались только CANCELED
}

/** Наиболее релевантный платёж набора для отображения способа/даты/сумм. */
function primaryPayment(payments: Payment[]): Payment | null {
  if (payments.length === 0) return null;
  const order: Payment["status"][] = [
    "SUCCEEDED",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
    "WAITING_FOR_CAPTURE",
    "PENDING",
    "CANCELED",
  ];
  const byRank = [...payments].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status)
  );
  return byRank[0];
}

function summarize(bookingId: string, payments: Payment[]): BookingPaymentSummary {
  const status = derivePaymentStatus(payments);
  const succeededTotal = payments
    .filter((p) => ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status))
    .reduce((sum, p) => sum + decimalToNumber(p.amount), 0);
  const refundedTotal = payments.reduce(
    (sum, p) => sum + decimalToNumber(p.refundedAmount),
    0
  );
  const primary = primaryPayment(payments);
  return {
    bookingId,
    status,
    amount: succeededTotal.toFixed(2),
    refundedAmount: refundedTotal.toFixed(2),
    paidAt: primary?.paidAt ? primary.paidAt.toISOString() : null,
    paymentMethodType: primary?.paymentMethodType ?? null,
  };
}

/**
 * Батч-агрегация статуса оплаты по списку броней — один запрос по
 * полиморфной связи (индекс @@index([subjectType, subjectId])). Пустой вход —
 * без запроса. Брони без платежей в Map отсутствуют (трактуются как NONE).
 */
export async function getBookingPaymentSummaries(
  bookingIds: string[]
): Promise<Map<string, BookingPaymentSummary>> {
  const result = new Map<string, BookingPaymentSummary>();
  if (bookingIds.length === 0) return result;

  const payments = await prisma.payment.findMany({
    where: { subjectType: "BOOKING", subjectId: { in: bookingIds } },
    orderBy: { createdAt: "asc" },
  });

  const byBooking = new Map<string, Payment[]>();
  for (const payment of payments) {
    const list = byBooking.get(payment.subjectId) ?? [];
    list.push(payment);
    byBooking.set(payment.subjectId, list);
  }
  for (const [bookingId, list] of byBooking) {
    result.set(bookingId, summarize(bookingId, list));
  }
  return result;
}

/** Детальная оплата одной брони (с возвратами) для страницы брони. */
export async function getBookingPaymentDetail(
  bookingId: string
): Promise<BookingPaymentDetail | null> {
  const payments = await prisma.payment.findMany({
    where: { subjectType: "BOOKING", subjectId: bookingId },
    include: { refunds: true },
    orderBy: { createdAt: "asc" },
  });
  if (payments.length === 0) return null;

  const summary = summarize(bookingId, payments);
  return {
    status: summary.status,
    amount: summary.amount,
    refundedAmount: summary.refundedAmount,
    paidAt: summary.paidAt,
    paymentMethodType: summary.paymentMethodType,
    payments,
  };
}

/**
 * Публичный статус платежа для страницы ожидания оплаты.
 * id (cuid) выступает capability-токеном; суммы и внутренние поля не отдаём.
 */
export async function getPublicPaymentStatus(id: string): Promise<PublicPaymentStatus | null> {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      confirmationUrl: true,
      moduleSlug: true,
      subjectType: true,
      subjectId: true,
    },
  });
  if (!payment) return null;

  // Для заказа кафе экран «Оплачено» показывает номер и состав (без сумм
  // и контактов — id платежа остаётся capability-токеном).
  let order: PublicPaymentStatus["order"] = null;
  if (payment.subjectType === "ORDER") {
    const orderRow = await prisma.order.findUnique({
      where: { id: payment.subjectId },
      select: { id: true, deliveryTo: true, items: { select: { name: true, quantity: true } } },
    });
    if (orderRow) {
      order = {
        orderNumber: orderRow.id.slice(-6).toUpperCase(),
        deliveryTo: orderRow.deliveryTo,
        items: orderRow.items.map((i) => ({ name: i.name ?? "Позиция", quantity: i.quantity })),
      };
    }
  }

  return {
    id: payment.id,
    status: payment.status,
    confirmationUrl: payment.status === "PENDING" ? payment.confirmationUrl : null,
    moduleSlug: payment.moduleSlug,
    order,
  };
}

/** Актуализация статуса по запросу страницы ожидания (fallback к вебхуку). */
export async function pollPayment(id: string): Promise<PublicPaymentStatus | null> {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return null;
  if (
    (NON_FINAL_STATUSES as readonly string[]).includes(payment.status) &&
    payment.providerPaymentId &&
    isYooKassaConfigured()
  ) {
    try {
      const remote = await yooGetPayment(payment.providerPaymentId);
      await applyProviderState(payment.id, remote);
    } catch {
      // провайдер недоступен — отдаём текущее локальное состояние
    }
  }
  return getPublicPaymentStatus(id);
}
