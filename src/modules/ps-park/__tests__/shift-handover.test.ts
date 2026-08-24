import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    shiftHandover: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { recordShiftHandover } from "../service";
import { prisma } from "@/lib/db";

type MockPrisma = {
  shiftHandover: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mp = prisma as unknown as MockPrisma;

/** Закрытая смена с расчётной наличкой 50 000 ₽. */
function makeShift(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    moduleSlug: "ps-park",
    date: "2026-08-14",
    status: "CLOSED",
    openedAt: new Date("2026-08-14T08:00:00.000Z"),
    openedById: "mgr-1",
    openedByName: "Менеджер Аня",
    closedAt: new Date("2026-08-14T22:00:00.000Z"),
    closedById: "mgr-1",
    closedByName: "Менеджер Аня",
    cashTotal: 50000,
    cardTotal: 12000,
    notes: null,
    handedOverAt: null,
    handedOverAmount: null,
    handedOverById: null,
    handedOverByName: null,
    handedOverTo: null,
    handoverNote: null,
    ...overrides,
  };
}

function mockTx(updateCount = 1, updatedShift?: Record<string, unknown>) {
  const updateMany = vi.fn();
  updateMany.mockResolvedValue({ count: updateCount });
  const findUniqueOrThrow = vi.fn();
  findUniqueOrThrow.mockResolvedValue(updatedShift ?? makeShift());
  const tx = {
    shiftHandover: { updateMany, findUniqueOrThrow },
    auditLog: { create: vi.fn() },
  };
  mp.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return tx;
}

const input = { amount: 50000, recipient: "Иванова О. П." };

describe("recordShiftHandover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mp.shiftHandover.findUnique.mockResolvedValue(makeShift());
  });

  it("записывает переданную сумму и получателя", async () => {
    const tx = mockTx();

    await recordShiftHandover("2026-08-14", "mgr-1", "Менеджер Аня", input);

    const data = tx.shiftHandover.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      handedOverAmount: 50000,
      handedOverTo: "Иванова О. П.",
      handedOverById: "mgr-1",
      handedOverByName: "Менеджер Аня",
    });
  });

  it("пишет расхождение в журнал, а не только сумму", async () => {
    const tx = mockTx();

    await recordShiftHandover("2026-08-14", "mgr-1", "Менеджер Аня", {
      amount: 48000,
      recipient: "Иванова О. П.",
      note: "Недостача, разбираемся",
    });

    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("shift.handover");
    expect(audit.metadata).toMatchObject({
      cashTotal: 50000,
      handedOverAmount: 48000,
      discrepancy: -2000,
      recipient: "Иванова О. П.",
    });
  });

  // Главный смысл фичи: расхождение без объяснения — молча потерянные деньги.
  it("не принимает расхождение без причины", async () => {
    mockTx();

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", { amount: 48000, recipient: "Иванова" })
    ).rejects.toMatchObject({ code: "DISCREPANCY_NOTE_REQUIRED" });
    expect(mp.$transaction).not.toHaveBeenCalled();
  });

  it("сумма ровно по расчёту проходит без причины", async () => {
    mockTx();

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", input)
    ).resolves.toBeTruthy();
  });

  it("излишек тоже требует объяснения — это не «просто повезло»", async () => {
    mockTx();

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", { amount: 51000, recipient: "Иванова" })
    ).rejects.toMatchObject({ code: "DISCREPANCY_NOTE_REQUIRED" });
  });

  it("не даёт передать выручку открытой смены — сумма ещё меняется", async () => {
    mp.shiftHandover.findUnique.mockResolvedValue(makeShift({ status: "OPEN" }));

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", input)
    ).rejects.toMatchObject({ code: "SHIFT_NOT_CLOSED" });
  });

  it("не даёт передать дважды", async () => {
    mp.shiftHandover.findUnique.mockResolvedValue(
      makeShift({ handedOverAt: new Date("2026-08-14T23:00:00.000Z") })
    );

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", input)
    ).rejects.toMatchObject({ code: "ALREADY_HANDED_OVER" });
  });

  it("параллельная передача не пишет второе событие в журнал", async () => {
    const tx = mockTx(0);

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", input)
    ).rejects.toMatchObject({ code: "ALREADY_HANDED_OVER" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("требует получателя", async () => {
    mockTx();

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", { amount: 50000, recipient: "   " })
    ).rejects.toMatchObject({ code: "RECIPIENT_REQUIRED" });
  });

  it("несуществующая смена — понятная ошибка, а не падение", async () => {
    mp.shiftHandover.findUnique.mockResolvedValue(null);

    await expect(
      recordShiftHandover("2026-08-14", "mgr-1", "Аня", input)
    ).rejects.toMatchObject({ code: "SHIFT_NOT_FOUND" });
  });

  it("в DTO возвращается разница, посчитанная от расчётной суммы", async () => {
    mockTx(1, makeShift({
      handedOverAt: new Date("2026-08-14T23:00:00.000Z"),
      handedOverAmount: 48000,
      handedOverById: "mgr-1",
      handedOverByName: "Менеджер Аня",
      handedOverTo: "Иванова О. П.",
      handoverNote: "Недостача",
    }));

    const result = await recordShiftHandover("2026-08-14", "mgr-1", "Аня", {
      amount: 48000,
      recipient: "Иванова О. П.",
      note: "Недостача",
    });

    expect(result.cashTotal).toBe(50000);
    expect(result.handover).toMatchObject({
      amount: 48000,
      discrepancy: -2000,
      to: "Иванова О. П.",
      note: "Недостача",
    });
  });
});
