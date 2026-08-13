import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findFirst: vi.fn() },
    resource: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { recordPrepayment, getPrepaidAmount, BookingPrepaymentError } from "../prepayment";
import { prisma } from "@/lib/db";

type MockPrisma = {
  booking: { findFirst: ReturnType<typeof vi.fn> };
  resource: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mp = prisma as unknown as MockPrisma;

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk-1",
    moduleSlug: "gazebos",
    resourceId: "res-1",
    status: "CONFIRMED",
    clientName: "Ксения Шмакова",
    date: new Date("2026-08-28T00:00:00.000Z"),
    metadata: { totalPrice: "8000" },
    ...overrides,
  };
}

function mockTx() {
  // Мок без реализации: с инлайновой стрелкой TS выводит пустой кортеж
  // аргументов, и `mock.calls[0][0]` перестаёт типизироваться.
  const update = vi.fn();
  update.mockResolvedValue(makeBooking());
  const tx = {
    booking: { update },
    financialTransaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  mp.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return tx;
}

const input = {
  bookingId: "bk-1",
  moduleSlug: "gazebos",
  actorId: "mgr-1",
  cashAmount: 3000,
  cardAmount: 0,
};

describe("getPrepaidAmount", () => {
  it("складывает наличные и карту из metadata", () => {
    expect(
      getPrepaidAmount({ prepaidCashAmount: "3000.00", prepaidCardAmount: "1500.00" })
    ).toBe(4500);
  });

  it("бронь без предоплаты даёт ноль, а не NaN", () => {
    expect(getPrepaidAmount(null)).toBe(0);
    expect(getPrepaidAmount({})).toBe(0);
  });
});

describe("recordPrepayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mp.booking.findFirst.mockResolvedValue(makeBooking());
    mp.resource.findUnique.mockResolvedValue({ name: "Беседка №5" });
    mp.user.findUnique.mockResolvedValue({ name: "Менеджер Аня", email: null });
  });

  it("записывает предоплату в metadata, не трогая статус брони", async () => {
    const tx = mockTx();

    await recordPrepayment(input);

    const data = tx.booking.update.mock.calls[0][0].data;
    expect(data.metadata).toMatchObject({
      prepaidCashAmount: "3000.00",
      prepaidCardAmount: "0.00",
    });
    // Статус — отдельная ось: оплата его не двигает.
    expect(data).not.toHaveProperty("status");
  });

  it("накапливает суммы, а не затирает прошлую предоплату", async () => {
    mp.booking.findFirst.mockResolvedValue(
      makeBooking({ metadata: { totalPrice: "8000", prepaidCashAmount: "2000.00" } })
    );
    const tx = mockTx();

    await recordPrepayment({ ...input, cashAmount: 1000, cardAmount: 500 });

    expect(tx.booking.update.mock.calls[0][0].data.metadata).toMatchObject({
      prepaidCashAmount: "3000.00",
      prepaidCardAmount: "500.00",
    });
  });

  it("сразу проводит деньги в кассу — сверка смены не должна ждать чекаута", async () => {
    const tx = mockTx();

    await recordPrepayment({ ...input, cashAmount: 3000, cardAmount: 2000 });

    const ft = tx.financialTransaction.create.mock.calls[0][0].data;
    expect(ft).toMatchObject({
      moduleSlug: "gazebos",
      type: "SESSION_PAYMENT",
      bookingId: "bk-1",
      totalAmount: 5000,
      cashAmount: 3000,
      cardAmount: 2000,
    });
    expect(ft.metadata).toMatchObject({ kind: "prepayment" });
  });

  it("пишет событие в историю брони", async () => {
    const tx = mockTx();

    await recordPrepayment(input);

    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("booking.paid");
    expect(audit.entityId).toBe("bk-1");
    expect(audit.metadata).toMatchObject({ totalAmount: 3000 });
  });

  it("не принимает нулевую оплату", async () => {
    await expect(
      recordPrepayment({ ...input, cashAmount: 0, cardAmount: 0 })
    ).rejects.toMatchObject({ code: "NOTHING_TO_RECORD" });
    expect(mp.booking.findFirst).not.toHaveBeenCalled();
  });

  it("не принимает оплату по завершённой брони — это правка задним числом", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ status: "COMPLETED" }));

    await expect(recordPrepayment(input)).rejects.toMatchObject({ code: "BOOKING_CLOSED" });
    expect(mp.$transaction).not.toHaveBeenCalled();
  });

  it("не принимает оплату по отменённой брони", async () => {
    mp.booking.findFirst.mockResolvedValue(makeBooking({ status: "CANCELLED" }));

    await expect(recordPrepayment(input)).rejects.toMatchObject({ code: "BOOKING_CLOSED" });
  });

  it("отдаёт понятную ошибку, если брони нет", async () => {
    mp.booking.findFirst.mockResolvedValue(null);

    await expect(recordPrepayment(input)).rejects.toBeInstanceOf(BookingPrepaymentError);
  });
});
