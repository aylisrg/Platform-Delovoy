import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    subscription: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    subscriptionTransaction: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn(),
}));

import {
  createSubscription,
  updateSubscription,
  cancelSubscription,
  adjustSubscriptionHours,
  listSubscriptions,
  getSubscription,
  getActiveSubscriptionForUser,
  SubscriptionError,
} from "@/modules/subscriptions/service";
import { prisma } from "@/lib/db";

const dec = (n: number) => new Prisma.Decimal(n);

const mockUser = (overrides = {}) => ({
  id: "user-1",
  role: "USER" as const,
  mergedIntoUserId: null,
  name: "Иван Иванов",
  email: "ivan@example.com",
  phone: "+79991234567",
  ...overrides,
});

const mockSub = (overrides = {}) => ({
  id: "sub-1",
  moduleSlug: "ps-park",
  userId: "user-1",
  totalHours: dec(10),
  remainingHours: dec(10),
  validFrom: new Date("2026-05-01"),
  validTo: new Date("2026-12-31"),
  status: "ACTIVE" as const,
  pricePaid: dec(5000),
  notes: null as string | null,
  cancelReason: null,
  cancelledAt: null,
  cancelledById: null,
  createdById: "manager-1",
  createdAt: new Date("2026-05-01"),
  updatedAt: new Date("2026-05-01"),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction mock — runs callback inline using top-level prisma
  vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
    }
    // Array form (used by listSubscriptions batch updateMany)
    return Promise.all(arg as Promise<unknown>[]);
  });
});

describe("createSubscription (F6)", () => {
  it("happy path — creates subscription, MANUAL_TOPUP transaction, AuditLog", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.subscription.create).mockResolvedValue({ id: "sub-1" } as never);

    const result = await createSubscription(
      {
        userId: "user-1",
        totalHours: 10,
        pricePaid: 5000,
        validFrom: "2026-05-01",
        validTo: "2026-12-31",
        notes: null,
      },
      "manager-1"
    );

    expect(result).toEqual({ id: "sub-1" });
    expect(prisma.subscriptionTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subscriptionId: "sub-1",
          type: "MANUAL_TOPUP",
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "subscription.create" }),
      })
    );
  });

  it("rejects duplicate ACTIVE — partial UNIQUE catch", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser() as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: "Менеджер",
      email: null,
    } as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" }
    );
    vi.mocked(prisma.subscription.create).mockRejectedValue(p2002 as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: "existing-sub",
    } as never);

    await expect(
      createSubscription(
        {
          userId: "user-1",
          totalHours: 5,
          pricePaid: 2500,
          validFrom: "2026-05-01",
          validTo: "2026-09-01",
          notes: null,
        },
        "manager-1"
      )
    ).rejects.toMatchObject({
      code: "ACTIVE_SUBSCRIPTION_EXISTS",
      metadata: { existingSubscriptionId: "existing-sub" },
    });
  });

  it("rejects non-USER role", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      mockUser({ role: "MANAGER" }) as never
    );

    await expect(
      createSubscription(
        {
          userId: "user-1",
          totalHours: 5,
          pricePaid: 2500,
          validFrom: "2026-05-01",
          validTo: "2026-09-01",
          notes: null,
        },
        "manager-1"
      )
    ).rejects.toMatchObject({ code: "INVALID_USER_ROLE" });
  });

  it("rejects tombstoned user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      mockUser({ mergedIntoUserId: "primary-1" }) as never
    );

    await expect(
      createSubscription(
        {
          userId: "user-1",
          totalHours: 5,
          pricePaid: 2500,
          validFrom: "2026-05-01",
          validTo: "2026-09-01",
          notes: null,
        },
        "manager-1"
      )
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});

describe("updateSubscription (F6)", () => {
  it("happy path — only notes changed", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      notes: "old",
      pricePaid: dec(5000),
      status: "ACTIVE",
    } as never);

    await updateSubscription("sub-1", { notes: "new" }, "manager-1");

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: "new" }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "subscription.update",
          metadata: expect.objectContaining({
            changes: expect.objectContaining({
              notes: { from: "old", to: "new" },
            }),
          }),
        }),
      })
    );
  });

  it("no-op when no changes", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      notes: "same",
      pricePaid: dec(5000),
      status: "ACTIVE",
    } as never);

    await updateSubscription("sub-1", { notes: "same" }, "manager-1");

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects when subscription not found", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);

    await expect(
      updateSubscription("missing", { notes: "x" }, "manager-1")
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });
  });
});

describe("cancelSubscription (F6)", () => {
  it("happy path", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
    } as never);

    await cancelSubscription("sub-1", { reason: "test" }, "super-1");

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledById: "super-1",
          cancelReason: "test",
        }),
      })
    );
  });

  it("rejects when already CANCELLED", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      status: "CANCELLED",
    } as never);

    await expect(
      cancelSubscription("sub-1", {}, "super-1")
    ).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
  });

  it("rejects when not ACTIVE (e.g. EXPIRED)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      status: "EXPIRED",
    } as never);

    await expect(
      cancelSubscription("sub-1", {}, "super-1")
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_ACTIVE" });
  });
});

describe("adjustSubscriptionHours (F6)", () => {
  it("INSUFFICIENT_HOURS for over-deduct", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      validTo: new Date("2026-12-31"),
      remainingHours: dec(1),
    } as never);

    await expect(
      adjustSubscriptionHours(
        "sub-1",
        { type: "MANUAL_DEDUCT", hours: 2, reason: "test deduct" },
        "manager-1"
      )
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_HOURS",
      metadata: { remainingHours: "1", requested: "2" },
    });
  });

  it("MANUAL_TOPUP increases balance + creates ST", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      validTo: new Date("2026-12-31"),
      remainingHours: dec(3),
    } as never);

    const result = await adjustSubscriptionHours(
      "sub-1",
      { type: "MANUAL_TOPUP", hours: 2, reason: "compensation" },
      "manager-1"
    );

    expect(result.balanceAfter).toBe("5");
    expect(prisma.subscriptionTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "MANUAL_TOPUP",
          balanceAfter: dec(5),
        }),
      })
    );
  });

  it("MANUAL_DEDUCT to zero auto-marks DEPLETED", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      validTo: new Date("2026-12-31"),
      remainingHours: dec(2),
    } as never);

    await adjustSubscriptionHours(
      "sub-1",
      { type: "MANUAL_DEDUCT", hours: 2, reason: "all out" },
      "manager-1"
    );

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DEPLETED" }),
      })
    );
  });
});

describe("listSubscriptions (F6)", () => {
  it("filters by status", async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      {
        ...mockSub(),
        user: { name: "Иван", phone: "+79991234567" },
      },
    ] as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(1 as never);

    const result = await listSubscriptions({ status: "ACTIVE" });

    expect(result.total).toBe(1);
    expect(result.items[0].userName).toBe("Иван");
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });
});

describe("getActiveSubscriptionForUser (F6 → F7)", () => {
  it("auto-EXPIRED when validTo passed", async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      ...mockSub({
        validTo: new Date("2020-01-01"),
        remainingHours: dec(5),
      }),
    } as never);

    const result = await getActiveSubscriptionForUser("user-1");
    expect(result).toBeNull();
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
        data: { status: "EXPIRED" },
      })
    );
  });

  it("auto-DEPLETED when remainingHours <= 0", async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      ...mockSub({
        validTo: new Date("2030-12-31"),
        remainingHours: dec(0),
      }),
    } as never);

    const result = await getActiveSubscriptionForUser("user-1");
    expect(result).toBeNull();
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "DEPLETED" },
      })
    );
  });

  it("returns subscription when active and valid", async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(mockSub() as never);

    const result = await getActiveSubscriptionForUser("user-1");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("sub-1");
  });

  it("returns null when no active subscription exists", async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);

    const result = await getActiveSubscriptionForUser("user-1");
    expect(result).toBeNull();
  });
});

describe("getSubscription (F6)", () => {
  it("returns detail with transaction history", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce({
      ...mockSub(),
      user: { name: "Иван", phone: "+79991234567" },
      transactions: [
        {
          id: "st-1",
          type: "MANUAL_TOPUP",
          hoursDelta: dec(10),
          balanceAfter: dec(10),
          bookingId: null,
          reason: "initial purchase",
          performedById: "manager-1",
          performedByName: "Менеджер",
          createdAt: new Date("2026-05-01"),
        },
      ],
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce({
      status: "ACTIVE",
    } as never);

    const result = await getSubscription("sub-1");
    expect(result).not.toBeNull();
    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0].type).toBe("MANUAL_TOPUP");
  });
});
