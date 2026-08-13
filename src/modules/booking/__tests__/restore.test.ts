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
