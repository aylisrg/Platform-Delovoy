import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  debitFromSession,
  SubscriptionDebitError,
} from "@/modules/subscriptions/debit";

const dec = (n: number) => new Prisma.Decimal(n);

function makeTx() {
  return {
    subscription: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    subscriptionTransaction: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
}

describe("debitFromSession (F7)", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    tx = makeTx();
  });

  // D1
  it("happy path: sufficient hours, status remains ACTIVE", async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 1 });
    tx.subscription.findUniqueOrThrow.mockResolvedValue({
      remainingHours: dec(8),
      status: "ACTIVE",
    });

    const result = await debitFromSession(tx as never, {
      subscriptionId: "sub-1",
      bookingId: "book-1",
      hours: 2,
      performedById: "manager-1",
      performedByName: "Тест Менеджер",
    });

    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
        status: "ACTIVE",
        remainingHours: { gte: 2 },
      },
      data: { remainingHours: { decrement: 2 } },
    });
    expect(tx.subscriptionTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subscriptionId: "sub-1",
          type: "CHARGE",
          hoursDelta: -2,
          balanceAfter: 8,
          bookingId: "book-1",
        }),
      })
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "subscription.debit_session",
          metadata: expect.objectContaining({
            bookingId: "book-1",
            hoursDebited: 2,
            remainingAfter: 8,
            becameDepleted: false,
          }),
        }),
      })
    );
    expect(result).toEqual({
      hoursDebited: 2,
      remainingAfter: 8,
      becameDepleted: false,
    });
  });

  // D2
  it("race lost (concurrent debit): updateMany count=0 → INSUFFICIENT_HOURS", async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 0 });
    tx.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      remainingHours: dec(0.5),
    });

    await expect(
      debitFromSession(tx as never, {
        subscriptionId: "sub-1",
        bookingId: "book-1",
        hours: 2,
        performedById: "manager-1",
        performedByName: "Менеджер",
      })
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_HOURS",
      metadata: {
        requested: 2,
        remainingHours: "0.5",
        currentStatus: "ACTIVE",
      },
    });
    expect(tx.subscriptionTransaction.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  // D3
  it("debit exhausts balance → auto-DEPLETED in same tx", async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 1 });
    tx.subscription.findUniqueOrThrow.mockResolvedValue({
      remainingHours: dec(0),
      status: "ACTIVE",
    });

    const result = await debitFromSession(tx as never, {
      subscriptionId: "sub-1",
      bookingId: "book-1",
      hours: 2,
      performedById: "manager-1",
      performedByName: "Менеджер",
    });

    // Two updateMany calls: one decrement, one status flip.
    expect(tx.subscription.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.subscription.updateMany).toHaveBeenLastCalledWith({
      where: { id: "sub-1", status: "ACTIVE" },
      data: { status: "DEPLETED" },
    });
    expect(result.becameDepleted).toBe(true);
  });

  // D4
  it("rejects hours <= 0 with INVALID_HOURS", async () => {
    await expect(
      debitFromSession(tx as never, {
        subscriptionId: "sub-1",
        bookingId: "book-1",
        hours: 0,
        performedById: "manager-1",
        performedByName: "Менеджер",
      })
    ).rejects.toMatchObject({ code: "INVALID_HOURS", metadata: { hours: 0 } });

    await expect(
      debitFromSession(tx as never, {
        subscriptionId: "sub-1",
        bookingId: "book-1",
        hours: -1,
        performedById: "manager-1",
        performedByName: "Менеджер",
      })
    ).rejects.toMatchObject({ code: "INVALID_HOURS" });

    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  });

  // D5
  it("does not flip status if subscription already CANCELLED (race-safe)", async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 0 });
    tx.subscription.findUnique.mockResolvedValue({
      status: "CANCELLED",
      remainingHours: dec(5),
    });

    await expect(
      debitFromSession(tx as never, {
        subscriptionId: "sub-1",
        bookingId: "book-1",
        hours: 2,
        performedById: "manager-1",
        performedByName: "Менеджер",
      })
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_HOURS",
      metadata: { currentStatus: "CANCELLED" },
    });
  });

  it("returns SubscriptionDebitError instance with proper class", async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 0 });
    tx.subscription.findUnique.mockResolvedValue(null);
    try {
      await debitFromSession(tx as never, {
        subscriptionId: "sub-1",
        bookingId: "book-1",
        hours: 1,
        performedById: "x",
        performedByName: "x",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SubscriptionDebitError);
    }
  });
});
