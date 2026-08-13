import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../slot-lock", () => ({
  lockSlot: vi.fn(async () => undefined),
}));

import {
  restoreBooking,
  restoreWindowHoursLeft,
  BookingRestoreError,
  RESTORE_WINDOW_HOURS,
} from "../restore";
import { prisma } from "@/lib/db";
import { lockSlot } from "../slot-lock";

type MockPrisma = {
  booking: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mp = prisma as unknown as MockPrisma;

const closedAt = new Date(Date.now() - 60 * 60 * 1000); // час назад

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk-1",
    moduleSlug: "gazebos",
    resourceId: "res-1",
    status: "COMPLETED",
    date: new Date("2026-08-13T00:00:00.000Z"),
    startTime: new Date("2026-08-13T13:00:00.000Z"),
    endTime: new Date("2026-08-13T17:00:00.000Z"),
    updatedAt: closedAt,
    cashAmount: null,
    cardAmount: null,
    ...overrides,
  };
}

/** Транзакция с подставным tx-клиентом; каждый тест настраивает его ответы. */
function mockTx(overrides: Record<string, unknown> = {}) {
  const tx = {
    $executeRaw: vi.fn(),
    booking: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => makeBooking({ status: "CONFIRMED" })),
    },
    auditLog: { create: vi.fn() },
    // #435: возврат часов абонемента при восстановлении ps-park-брони.
    // Дефолт «нечего возвращать» — не трогает существующие gazebos-тесты
    // (у них moduleSlug !== "ps-park", до этих вызовов дело не доходит).
    subscriptionTransaction: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
    },
    subscription: {
      findUniqueOrThrow: vi.fn(async () => ({ status: "ACTIVE" })),
      update: vi.fn(async () => ({ remainingHours: 0 })),
    },
    user: {
      findUnique: vi.fn(async () => ({ name: "Админ", email: "admin@example.com" })),
    },
    ...overrides,
  };
  mp.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return tx;
}

const input = {
  bookingId: "bk-1",
  moduleSlug: "gazebos",
  actorId: "superadmin-1",
};

describe("restoreWindowHoursLeft", () => {
  it("сразу после закрытия окно почти полное", () => {
    expect(restoreWindowHoursLeft(new Date())).toBeCloseTo(RESTORE_WINDOW_HOURS, 0);
  });

  it("после истечения окна возвращает 0, а не отрицательное число", () => {
    const long = new Date(Date.now() - (RESTORE_WINDOW_HOURS + 5) * 60 * 60 * 1000);
    expect(restoreWindowHoursLeft(long)).toBe(0);
  });
});

describe("restoreBooking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("возвращает завершённую бронь в CONFIRMED и пишет событие в журнал", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking());
    const tx = mockTx();

    const result = await restoreBooking({ ...input, reason: "Завершили не ту бронь" });

    expect(result.status).toBe("CONFIRMED");
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bk-1", status: "COMPLETED" },
        data: { status: "CONFIRMED", managerId: "superadmin-1" },
      })
    );
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("booking.restore");
    expect(audit.metadata).toMatchObject({
      previousStatus: "COMPLETED",
      newStatus: "CONFIRMED",
      reason: "Завершили не ту бронь",
    });
  });

  it("восстанавливает и отменённую бронь", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ status: "CANCELLED" }));
    const tx = mockTx({
      booking: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => makeBooking({ status: "CONFIRMED" })),
      },
    });

    await restoreBooking(input);

    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bk-1", status: "CANCELLED" } })
    );
  });

  // AC-3 и дыра #478: реактивация без конфликт-чека создаёт двойную бронь.
  it("блокирует восстановление, если слот успели пересдать", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking());
    const tx = mockTx({
      booking: {
        findFirst: vi.fn(async () => ({
          id: "bk-2",
          clientName: "Другой гость",
          startTime: new Date(),
          endTime: new Date(),
        })),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    });

    await expect(restoreBooking(input)).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("берёт блокировку слота до конфликт-чека, иначе гонка остаётся открытой", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking());
    const tx = mockTx();

    await restoreBooking(input);

    expect(lockSlot).toHaveBeenCalledWith(tx, "gazebos", "res-1", expect.any(Date));
    const lockOrder = vi.mocked(lockSlot).mock.invocationCallOrder[0];
    const checkOrder = tx.booking.findFirst.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(checkOrder);
  });

  it("не восстанавливает бронь после истечения окна", async () => {
    const stale = new Date(Date.now() - (RESTORE_WINDOW_HOURS + 1) * 60 * 60 * 1000);
    mp.booking.findFirst.mockResolvedValue(makeBooking({ updatedAt: stale }));
    mockTx();

    await expect(restoreBooking(input)).rejects.toMatchObject({
      code: "RESTORE_WINDOW_EXPIRED",
    });
    expect(mp.$transaction).not.toHaveBeenCalled();
  });

  it("не трогает активную бронь — восстанавливать нечего", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ status: "CONFIRMED" }));

    await expect(restoreBooking(input)).rejects.toMatchObject({ code: "NOT_RESTORABLE" });
  });

  it("отдаёт понятную ошибку, если брони нет", async () => {
    mp.booking.findFirst.mockResolvedValue(null);

    await expect(restoreBooking(input)).rejects.toBeInstanceOf(BookingRestoreError);
  });

  it("не пишет второе событие, если бронь восстановил параллельный запрос", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking());
    const tx = mockTx({
      booking: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUniqueOrThrow: vi.fn(),
      },
    });

    await expect(restoreBooking(input)).rejects.toMatchObject({ code: "ALREADY_RESTORED" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("не откатывает деньги — фиксирует их в журнале как оставшиеся (AC-6)", async () => {
    mp.booking.findFirst.mockResolvedValue(
      makeBooking({ cashAmount: { toString: () => "8000" }, cardAmount: null })
    );
    const tx = mockTx();

    await restoreBooking(input);

    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      revenueKept: true,
      cashAmount: "8000",
    });
  });
});

// ===== #435: возврат часов абонемента при восстановлении ps-park-сессии =====
//
// debitFromSession() списывает часы на COMPLETED, но восстановление обратно
// в CONFIRMED (эта функция) их не возвращало — гость терял часы без
// компенсации. SubscriptionTransaction.REFUND был объявлен в схеме, но
// нигде не писался.
describe("restoreBooking возвращает часы абонемента (#435)", () => {
  const psParkInput = { ...input, moduleSlug: "ps-park" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("возвращает списанные часы и пишет REFUND-транзакцию", async () => {
    mp.booking.findFirst.mockResolvedValue(
      makeBooking({ moduleSlug: "ps-park", resourceId: "table-1" })
    );
    const tx = mockTx({
      subscriptionTransaction: {
        findMany: vi.fn(async () => [{ subscriptionId: "sub-1", hoursDelta: -2 }]),
        create: vi.fn(),
      },
      subscription: {
        findUniqueOrThrow: vi.fn(async () => ({ status: "ACTIVE" })),
        update: vi.fn(async () => ({ remainingHours: 5 })),
      },
    });

    await restoreBooking(psParkInput);

    expect(tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub-1" },
        data: expect.objectContaining({ remainingHours: { increment: 2 } }),
      })
    );
    expect(tx.subscriptionTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subscriptionId: "sub-1",
          type: "REFUND",
          hoursDelta: 2,
          bookingId: "bk-1",
        }),
      })
    );
    // Два auditLog.create: сперва subscription.refund_session (внутри
    // refundToSubscription), затем booking.restore — ищем по action, а не
    // по индексу, чтобы порядок не был скрытой хрупкостью теста.
    const restoreAudit = tx.auditLog.create.mock.calls.find(
      (c) => c[0].data.action === "booking.restore"
    )?.[0].data;
    expect(restoreAudit.metadata).toMatchObject({
      subscriptionRefund: { subscriptionId: "sub-1", hoursRefunded: 2 },
    });
    const refundAudit = tx.auditLog.create.mock.calls.find(
      (c) => c[0].data.action === "subscription.refund_session"
    )?.[0].data;
    expect(refundAudit.metadata).toMatchObject({
      bookingId: "bk-1",
      hoursRefunded: 2,
      remainingAfter: 5,
    });
  });

  it("реактивирует DEPLETED абонемент после возврата часов", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ moduleSlug: "ps-park" }));
    const tx = mockTx({
      subscriptionTransaction: {
        findMany: vi.fn(async () => [{ subscriptionId: "sub-1", hoursDelta: -3 }]),
        create: vi.fn(),
      },
      subscription: {
        findUniqueOrThrow: vi.fn(async () => ({ status: "DEPLETED" })),
        update: vi.fn(async () => ({ remainingHours: 3 })),
      },
    });

    await restoreBooking(psParkInput);

    expect(tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  it("не возвращает часы повторно, если уже возвращены (net owed = 0)", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ moduleSlug: "ps-park" }));
    const tx = mockTx({
      subscriptionTransaction: {
        // Уже был и CHARGE, и REFUND по этой же брони — сумма даёт 0.
        findMany: vi.fn(async () => [
          { subscriptionId: "sub-1", hoursDelta: -2 },
          { subscriptionId: "sub-1", hoursDelta: 2 },
        ]),
        create: vi.fn(),
      },
    });

    await restoreBooking(psParkInput);

    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.subscriptionTransaction.create).not.toHaveBeenCalled();
  });

  it("не трогает подписки, если сессия была оплачена не абонементом", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ moduleSlug: "ps-park" }));
    const tx = mockTx(); // дефолт: subscriptionTransaction.findMany() → []

    await restoreBooking(psParkInput);

    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.subscriptionTransaction.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).not.toHaveProperty(
      "subscriptionRefund"
    );
  });

  it("не трогает подписки для брони другого модуля (gazebos)", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ moduleSlug: "gazebos" }));
    const tx = mockTx({
      subscriptionTransaction: {
        findMany: vi.fn(async () => [{ subscriptionId: "sub-1", hoursDelta: -2 }]),
        create: vi.fn(),
      },
    });

    await restoreBooking(input); // moduleSlug: "gazebos"

    expect(tx.subscriptionTransaction.findMany).not.toHaveBeenCalled();
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });
});
