import type { Prisma } from "@prisma/client";

export class SubscriptionDebitError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "SubscriptionDebitError";
    if (metadata) this.metadata = metadata;
  }
}

export type DebitFromSessionArgs = {
  subscriptionId: string;
  bookingId: string;
  hours: number;
  performedById: string;
  performedByName: string;
};

export type DebitFromSessionResult = {
  hoursDebited: number;
  remainingAfter: number;
  becameDepleted: boolean;
};

/**
 * Atomically debit `hours` from a Subscription within an existing transaction.
 *
 * MUST be called inside `prisma.$transaction(async (tx) => { ... })` from the
 * caller (ps-park service). All four writes (Subscription update + ST insert
 * + AuditLog insert + caller's FT/Booking writes) commit together.
 *
 * Race-safety: uses `updateMany WHERE id=? AND status=ACTIVE AND remainingHours >= ?`
 * (atomic compare-and-swap). If two concurrent debits race, the second receives
 * `count = 0` → throws INSUFFICIENT_HOURS.
 *
 * Lazy auto-DEPLETED: if `remainingAfter === 0`, sets status='DEPLETED' in the
 * same tx. Lazy auto-EXPIRED is checked by the caller via getActiveSubscriptionForUser.
 */
export async function debitFromSession(
  tx: Prisma.TransactionClient,
  args: DebitFromSessionArgs
): Promise<DebitFromSessionResult> {
  const { subscriptionId, bookingId, hours, performedById, performedByName } = args;

  if (hours <= 0) {
    throw new SubscriptionDebitError(
      "INVALID_HOURS",
      "Часы для списания должны быть положительными",
      { hours }
    );
  }

  const updateRes = await tx.subscription.updateMany({
    where: {
      id: subscriptionId,
      status: "ACTIVE",
      remainingHours: { gte: hours },
    },
    data: {
      remainingHours: { decrement: hours },
    },
  });

  if (updateRes.count === 0) {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { status: true, remainingHours: true },
    });
    throw new SubscriptionDebitError(
      "INSUFFICIENT_HOURS",
      "Недостаточно часов на абонементе",
      {
        requested: hours,
        remainingHours: sub?.remainingHours.toString() ?? "0",
        currentStatus: sub?.status ?? "UNKNOWN",
      }
    );
  }

  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { remainingHours: true, status: true },
  });
  const remainingAfter = Number(sub.remainingHours);
  const becameDepleted = remainingAfter <= 0 && sub.status === "ACTIVE";

  if (becameDepleted) {
    await tx.subscription.updateMany({
      where: { id: subscriptionId, status: "ACTIVE" },
      data: { status: "DEPLETED" },
    });
  }

  await tx.subscriptionTransaction.create({
    data: {
      subscriptionId,
      type: "CHARGE",
      hoursDelta: -hours,
      balanceAfter: remainingAfter,
      bookingId,
      performedById,
      performedByName,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: performedById,
      action: "subscription.debit_session",
      entity: "Subscription",
      entityId: subscriptionId,
      metadata: {
        bookingId,
        hoursDebited: hours,
        remainingAfter,
        becameDepleted,
      },
    },
  });

  return { hoursDebited: hours, remainingAfter, becameDepleted };
}

export type RefundToSubscriptionArgs = {
  subscriptionId: string;
  bookingId: string;
  hours: number;
  performedById: string;
  performedByName: string;
  reason?: string;
};

export type RefundToSubscriptionResult = {
  hoursRefunded: number;
  remainingAfter: number;
  reactivated: boolean;
};

/**
 * Atomically credit `hours` back to a Subscription within an existing
 * transaction — the reverse of `debitFromSession()`. Used when a COMPLETED,
 * subscription-paid ps-park session is restored/cancelled after the fact
 * (#435): the charge already happened, and without an explicit refund the
 * guest's hours are gone with no compensation.
 *
 * Unlike `debitFromSession`, does NOT require `status: "ACTIVE"` — a charge
 * that drained the subscription to DEPLETED must still be refundable, and
 * doing so flips the subscription back to ACTIVE (the exact reverse of the
 * auto-DEPLETED transition in `debitFromSession`). EXPIRED/CANCELLED
 * subscriptions are left in that status — the refund still corrects the
 * balance/ledger, it just doesn't resurrect a subscription past its
 * `validTo` or one the guest/manager intentionally cancelled.
 */
export async function refundToSubscription(
  tx: Prisma.TransactionClient,
  args: RefundToSubscriptionArgs
): Promise<RefundToSubscriptionResult> {
  const { subscriptionId, bookingId, hours, performedById, performedByName, reason } = args;

  if (hours <= 0) {
    throw new SubscriptionDebitError(
      "INVALID_HOURS",
      "Часы для возврата должны быть положительными",
      { hours }
    );
  }

  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { status: true },
  });
  const reactivate = sub.status === "DEPLETED";

  const updated = await tx.subscription.update({
    where: { id: subscriptionId },
    data: {
      remainingHours: { increment: hours },
      ...(reactivate && { status: "ACTIVE" }),
    },
    select: { remainingHours: true },
  });
  const remainingAfter = Number(updated.remainingHours);

  await tx.subscriptionTransaction.create({
    data: {
      subscriptionId,
      type: "REFUND",
      hoursDelta: hours,
      balanceAfter: remainingAfter,
      bookingId,
      reason,
      performedById,
      performedByName,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: performedById,
      action: "subscription.refund_session",
      entity: "Subscription",
      entityId: subscriptionId,
      metadata: {
        bookingId,
        hoursRefunded: hours,
        remainingAfter,
        reactivated: reactivate,
        ...(reason && { reason }),
      },
    },
  });

  return { hoursRefunded: hours, remainingAfter, reactivated: reactivate };
}
