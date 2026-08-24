// @vitest-environment jsdom
//
// QA BUG-1: пояснение к передаче кассы рисовалось только внутри баннера
// расхождения. Если исправленная сумма сошлась с расчётной, обязательная
// причина коррекции сохранялась в БД и журнале, но пропадала со всех экранов.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { ShiftPanel } from "../shift-panel";
import type { ShiftHandoverRecord } from "@/modules/ps-park/types";

const report = {
  date: "2026-08-14",
  totalSessions: 4,
  cashTotal: 50000,
  cardTotal: 12000,
  totalRevenue: 62000,
  cashCount: 3,
  cardCount: 1,
  transactions: [],
};

function renderPanel(handover: ShiftHandoverRecord) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({
        success: true,
        data: {
          shift: {
            id: "shift-1",
            date: "2026-08-14",
            status: "CLOSED",
            openedAt: "2026-08-14T08:00:00.000Z",
            openedById: "mgr-1",
            openedByName: "Аня",
            closedAt: "2026-08-14T22:00:00.000Z",
            closedById: "mgr-1",
            closedByName: "Аня",
            notes: null,
            cashTotal: 50000,
            cardTotal: 12000,
            handover,
          },
          report,
        },
      }),
    }))
  );
  render(<ShiftPanel date="2026-08-14" />);
}

const base: ShiftHandoverRecord = {
  at: "2026-08-14T23:00:00.000Z",
  amount: 50000,
  discrepancy: 0,
  byId: "mgr-1",
  byName: "Аня",
  to: "Иванова О. П.",
  note: null,
  correctedAt: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShiftPanel — сводка передачи кассы", () => {
  it("показывает причину коррекции, когда суммы сошлись", async () => {
    renderPanel({
      ...base,
      note: "Ошиблись при вводе, пересчитали",
      correctedAt: "2026-08-15T09:00:00.000Z",
    });

    expect(await screen.findByText(/Ошиблись при вводе, пересчитали/)).toBeTruthy();
    expect(screen.getByText(/Запись исправлена/)).toBeTruthy();
    // Баннера расхождения быть не должно — суммы сошлись.
    expect(screen.queryByText(/Расхождение с расчётной суммой/)).toBeNull();
  });

  it("при расхождении причина остаётся в баннере и не дублируется", async () => {
    renderPanel({ ...base, amount: 48000, discrepancy: -2000, note: "Недостача" });

    const banner = await screen.findByText(/Расхождение с расчётной суммой/);
    expect(banner.textContent).toContain("Недостача");
    expect(screen.getAllByText(/Недостача/)).toHaveLength(1);
  });

  it("без пояснения лишней пустой строки не рисует", async () => {
    renderPanel(base);

    await waitFor(() => expect(screen.getByText(/Передано в бухгалтерию/)).toBeTruthy());
    expect(screen.queryByText(/Запись исправлена/)).toBeNull();
  });
});
