import { Prisma, type SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { createOnlinePayment } from "@/modules/payments/service";
import { PaymentError } from "@/modules/payments/types";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import type {
  AdjustHoursInput,
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  ListSubscriptionsFilter,
  UpdateSubscriptionInput,
} from "./validation";
import type {
  ListSubscriptionsResult,
  SubscriptionDetail,
  SubscriptionSummary,
} from "./types";

const MODULE_SLUG = "ps-park";

export class SubscriptionError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "SubscriptionError";
    if (metadata) this.metadata = metadata;
  }
}

// === Helpers ===

async function loadActiveUserOrThrow(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      mergedIntoUserId: true,
      name: true,
      email: true,
      phone: true,
    },
  });
  if (!user || user.mergedIntoUserId) {
    throw new SubscriptionError("USER_NOT_FOUND", "Гость не найден");
  }
  if (user.role !== "USER") {
    throw new SubscriptionError(
      "INVALID_USER_ROLE",
      "Абонемент можно выписать только гостю (role=USER)"
    );
  }
  return user;
}

async function loadPerformer(performedById: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: performedById },
    select: { name: true, email: true },
  });
  return u?.name ?? u?.email ?? "Менеджер";
}

/**
 * Lazy auto-status: if validTo passed → EXPIRED; if remainingHours <= 0 → DEPLETED.
 * EXPIRED has priority over DEPLETED (PRD §Бизнес-правила п.4).
 * Concurrent-safe via updateMany WHERE status='ACTIVE' (atomic compare-and-swap).
 */
async function recomputeStatusIfStale(sub: {
  id: string;
  status: SubscriptionStatus;
  validTo: Date;
  remainingHours: Prisma.Decimal;
}): Promise<SubscriptionStatus> {
  if (sub.status !== "ACTIVE") return sub.status;
  const now = new Date();
  if (sub.validTo < now) {
    await prisma.subscription.updateMany({
      where: { id: sub.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    return "EXPIRED";
  }
  if (Number(sub.remainingHours) <= 0) {
    await prisma.subscription.updateMany({
      where: { id: sub.id, status: "ACTIVE" },
      data: { status: "DEPLETED" },
    });
    return "DEPLETED";
  }
  return "ACTIVE";
}

// === Public API ===

export async function createSubscription(
  input: CreateSubscriptionInput,
  performedById: string
): Promise<{ id: string; payment?: { id: string; confirmationUrl: string | null } }> {
  const targetUser = await loadActiveUserOrThrow(input.userId);
  const performerName = await loadPerformer(performedById);

  const validFrom = new Date(input.validFrom);
  const validTo = new Date(input.validTo);
  const isOnline = input.paymentMethod === "online";

  if (isOnline) {
    if (!isYooKassaConfigured()) {
      throw new SubscriptionError(
        "PAYMENTS_NOT_CONFIGURED",
        "Онлайн-оплата не настроена — примите оплату на месте"
      );
    }
    if (input.pricePaid <= 0) {
      throw new SubscriptionError(
        "INVALID_PRICE",
        "Для онлайн-оплаты цена должна быть больше нуля"
      );
    }
    // Пре-чек «один ACTIVE на гостя»: при онлайн-продаже конфликт всплыл бы
    // только при активации по вебхуку (деньги уже списаны) — ловим заранее.
    const existing = await prisma.subscription.findFirst({
      where: { userId: input.userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (existing) {
      throw new SubscriptionError(
        "ACTIVE_SUBSCRIPTION_EXISTS",
        "У гостя уже есть активный абонемент",
        { existingSubscriptionId: existing.id }
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          moduleSlug: MODULE_SLUG,
          userId: input.userId,
          totalHours: new Prisma.Decimal(input.totalHours),
          remainingHours: new Prisma.Decimal(input.totalHours),
          validFrom,
          validTo,
          // Онлайн-пасс ждёт оплаты; активация и стартовая транзакция часов —
          // в subjects/subscription.ts после payment.succeeded.
          ...(isOnline && { status: "PENDING_PAYMENT" as const }),
          pricePaid: new Prisma.Decimal(input.pricePaid),
          notes: input.notes ?? null,
          createdById: performedById,
        },
        select: { id: true },
      });

      if (!isOnline) {
        await tx.subscriptionTransaction.create({
          data: {
            subscriptionId: sub.id,
            type: "MANUAL_TOPUP",
            hoursDelta: new Prisma.Decimal(input.totalHours),
            balanceAfter: new Prisma.Decimal(input.totalHours),
            reason: "initial purchase",
            performedById,
            performedByName: performerName,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: performedById,
          action: "subscription.create",
          entity: "Subscription",
          entityId: sub.id,
          metadata: {
            moduleSlug: MODULE_SLUG,
            targetUserId: input.userId,
            totalHours: input.totalHours,
            pricePaid: input.pricePaid,
            paymentMethod: input.paymentMethod,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
          },
        },
      });

      return sub;
    });

    if (!isOnline) return result;

    try {
      const payment = await createOnlinePayment({
        subjectType: "SUBSCRIPTION",
        subjectId: result.id,
        moduleSlug: MODULE_SLUG,
        amount: input.pricePaid,
        description: `Абонемент Плей Парк: ${input.totalHours} ч`,
        userId: input.userId,
        createdById: performedById,
        customerEmail: targetUser.email,
        customerPhone: targetUser.phone,
        receiptItems: [
          {
            description: `Абонемент Плей Парк: ${input.totalHours} ч`,
            amount: input.pricePaid,
          },
        ],
        returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/payments/{paymentId}`,
        metadata: { subscriptionId: result.id },
      });
      return {
        id: result.id,
        payment: { id: payment.id, confirmationUrl: payment.confirmationUrl },
      };
    } catch (paymentErr) {
      // Платёж не создан — незачем держать пасс в PENDING_PAYMENT.
      await prisma.subscription.update({
        where: { id: result.id },
        data: {
          status: "CANCELLED",
          cancelReason: "Платёж не создан",
          cancelledAt: new Date(),
          cancelledById: performedById,
        },
      });
      if (paymentErr instanceof PaymentError) {
        throw new SubscriptionError(paymentErr.code, paymentErr.message);
      }
      throw paymentErr;
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Partial UNIQUE caught — find existing ACTIVE for nicer error metadata.
      const existing = await prisma.subscription.findFirst({
        where: { userId: input.userId, status: "ACTIVE" },
        select: { id: true },
      });
      throw new SubscriptionError(
        "ACTIVE_SUBSCRIPTION_EXISTS",
        "У гостя уже есть активный абонемент",
        existing ? { existingSubscriptionId: existing.id } : undefined
      );
    }
    throw err;
  }
}

export async function updateSubscription(
  id: string,
  input: UpdateSubscriptionInput,
  performedById: string
): Promise<void> {
  const existing = await prisma.subscription.findUnique({
    where: { id },
    select: { id: true, notes: true, pricePaid: true, status: true },
  });
  if (!existing) {
    throw new SubscriptionError("SUBSCRIPTION_NOT_FOUND", "Абонемент не найден");
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const data: Prisma.SubscriptionUpdateInput = {};

  if (input.notes !== undefined) {
    const next = input.notes ?? null;
    if (next !== existing.notes) {
      changes.notes = { from: existing.notes, to: next };
      data.notes = next;
    }
  }
  if (input.pricePaid !== undefined) {
    const next = new Prisma.Decimal(input.pricePaid);
    if (!next.eq(existing.pricePaid)) {
      changes.pricePaid = {
        from: existing.pricePaid.toString(),
        to: next.toString(),
      };
      data.pricePaid = next;
    }
  }

  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        userId: performedById,
        action: "subscription.update",
        entity: "Subscription",
        entityId: id,
        metadata: { changes } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

export async function adjustSubscriptionHours(
  id: string,
  input: AdjustHoursInput,
  performedById: string
): Promise<{ balanceAfter: string }> {
  const performerName = await loadPerformer(performedById);
  const delta = new Prisma.Decimal(input.hours);

  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        validTo: true,
        remainingHours: true,
      },
    });
    if (!sub) {
      throw new SubscriptionError("SUBSCRIPTION_NOT_FOUND", "Абонемент не найден");
    }
    if (sub.status !== "ACTIVE") {
      throw new SubscriptionError(
        "SUBSCRIPTION_NOT_ACTIVE",
        "Корректировка возможна только для активного абонемента"
      );
    }

    const signedDelta = input.type === "MANUAL_TOPUP" ? delta : delta.negated();

    if (input.type === "MANUAL_DEDUCT" && delta.gt(sub.remainingHours)) {
      throw new SubscriptionError(
        "INSUFFICIENT_HOURS",
        "На балансе недостаточно часов",
        {
          remainingHours: sub.remainingHours.toString(),
          requested: delta.toString(),
        }
      );
    }

    const newBalance = sub.remainingHours.add(signedDelta);
    const becameDepleted =
      input.type === "MANUAL_DEDUCT" && newBalance.lte(0);

    await tx.subscription.update({
      where: { id },
      data: {
        remainingHours: newBalance,
        ...(becameDepleted && { status: "DEPLETED" }),
      },
    });

    await tx.subscriptionTransaction.create({
      data: {
        subscriptionId: id,
        type: input.type,
        hoursDelta: signedDelta,
        balanceAfter: newBalance,
        reason: input.reason,
        performedById,
        performedByName: performerName,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: performedById,
        action: "subscription.update",
        entity: "Subscription",
        entityId: id,
        metadata: {
          subOp: "adjust",
          type: input.type,
          hoursDelta: signedDelta.toString(),
          balanceAfter: newBalance.toString(),
          reason: input.reason,
        },
      },
    });

    return { balanceAfter: newBalance.toString() };
  });
}

export async function cancelSubscription(
  id: string,
  input: CancelSubscriptionInput,
  performedById: string
): Promise<void> {
  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!sub) {
    throw new SubscriptionError("SUBSCRIPTION_NOT_FOUND", "Абонемент не найден");
  }
  if (sub.status === "CANCELLED") {
    throw new SubscriptionError("ALREADY_CANCELLED", "Абонемент уже отменён");
  }
  if (sub.status !== "ACTIVE") {
    throw new SubscriptionError(
      "SUBSCRIPTION_NOT_ACTIVE",
      "Отменить можно только активный абонемент"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: performedById,
        cancelReason: input.reason ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: performedById,
        action: "subscription.cancel",
        entity: "Subscription",
        entityId: id,
        metadata: { reason: input.reason ?? null },
      },
    });
  });
  // Outside the tx — fire-and-forget audit log helper for cross-module consistency.
  await logAudit(performedById, "subscription.cancelled", "Subscription", id, {});
}

function toSummary(row: {
  id: string;
  userId: string;
  totalHours: Prisma.Decimal;
  remainingHours: Prisma.Decimal;
  validFrom: Date;
  validTo: Date;
  status: SubscriptionStatus;
  pricePaid: Prisma.Decimal;
  createdAt: Date;
  user: { name: string | null; phone: string | null };
}): SubscriptionSummary {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    userPhone: row.user.phone,
    totalHours: row.totalHours.toString(),
    remainingHours: row.remainingHours.toString(),
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    status: row.status,
    pricePaid: row.pricePaid.toString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSubscriptions(
  filter: ListSubscriptionsFilter
): Promise<ListSubscriptionsResult> {
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  // Batch lazy auto-status: bulk-update any ACTIVE rows whose
  // validTo passed or remainingHours <= 0 BEFORE the SELECT, so the
  // status filter sees the truth.
  const now = new Date();
  await prisma.$transaction([
    prisma.subscription.updateMany({
      where: { status: "ACTIVE", validTo: { lt: now } },
      data: { status: "EXPIRED" },
    }),
    prisma.subscription.updateMany({
      where: { status: "ACTIVE", remainingHours: { lte: 0 } },
      data: { status: "DEPLETED" },
    }),
  ]);

  const where: Prisma.SubscriptionWhereInput = {
    moduleSlug: MODULE_SLUG,
    ...(filter.status && { status: filter.status }),
    ...(filter.userId && { userId: filter.userId }),
    ...(filter.search && {
      user: {
        OR: [
          { name: { contains: filter.search, mode: "insensitive" } },
          { phone: { contains: filter.search } },
          { phoneNormalized: { contains: filter.search } },
        ],
      },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        user: { select: { name: true, phone: true } },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  return { items: items.map(toSummary), total };
}

export async function getSubscription(
  id: string
): Promise<SubscriptionDetail | null> {
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, phone: true } },
      transactions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!sub) return null;

  await recomputeStatusIfStale({
    id: sub.id,
    status: sub.status,
    validTo: sub.validTo,
    remainingHours: sub.remainingHours,
  });

  // Re-read status after recompute to keep payload consistent.
  const fresh = await prisma.subscription.findUnique({
    where: { id },
    select: { status: true },
  });

  return {
    ...toSummary(sub),
    status: fresh?.status ?? sub.status,
    notes: sub.notes,
    cancelReason: sub.cancelReason,
    cancelledAt: sub.cancelledAt ? sub.cancelledAt.toISOString() : null,
    createdById: sub.createdById,
    transactions: sub.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      hoursDelta: t.hoursDelta.toString(),
      balanceAfter: t.balanceAfter.toString(),
      bookingId: t.bookingId,
      reason: t.reason,
      performedByName: t.performedByName,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

/**
 * Public helper exported for F7 (auto-debit on session completion).
 * Returns the active subscription for `userId`, or null if none.
 * Lazily recomputes status — never returns a stale ACTIVE record.
 */
export async function getActiveSubscriptionForUser(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  if (!sub) return null;
  const status = await recomputeStatusIfStale(sub);
  if (status !== "ACTIVE") return null;
  return sub;
}
