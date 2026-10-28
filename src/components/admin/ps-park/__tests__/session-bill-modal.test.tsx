// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionBillModal } from "../session-bill-modal";
import type { BookingBill } from "@/modules/ps-park/types";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const bill: BookingBill = {
  bookingId: "booking-1", resourceName: "Стол 1", clientName: "Гость",
  date: "2026-10-27", startTime: "10:00", endTime: "12:00",
  durationMin: 120, billedHours: 2, pricePerHour: 500, hoursCost: 1000,
  items: [], itemsTotal: 0, totalBill: 1000, onlinePaidAmount: 200,
  prepaidAmount: 350,
};

afterEach(cleanup);

describe("SessionBillModal — ранее принятые деньги", () => {
  it("показывает оба источника оплаты и отправляет только остаток на завершение", () => {
    const onConfirm = vi.fn();
    render(<SessionBillModal bill={bill} isOpen onClose={vi.fn()} onConfirm={onConfirm} confirming={false} />);
    expect(screen.getByText("Оплачено онлайн")).toBeTruthy();
    expect(screen.getByText("Предоплата на месте")).toBeTruthy();
    expect((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value).toBe("450");

    fireEvent.click(screen.getByRole("button", { name: "Завершить сессию" }));
    expect(onConfirm).toHaveBeenCalledWith({ cashAmount: 450, cardAmount: 0 });
  });

  it.each([800, 1200])("при предоплате %s не предлагает повторную оплату", (prepaidAmount) => {
    const onConfirm = vi.fn();
    render(<SessionBillModal bill={{ ...bill, prepaidAmount }} isOpen onClose={vi.fn()} onConfirm={onConfirm} confirming={false} />);
    expect(screen.queryByRole("button", { name: /Оплатить онлайн/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Завершить сессию" }));
    expect(onConfirm).toHaveBeenCalledWith({ cashAmount: 0, cardAmount: 0 });
  });

  it("старый ответ без prepaidAmount сохраняет прежний расчёт", () => {
    render(<SessionBillModal bill={{ ...bill, prepaidAmount: undefined }} isOpen onClose={vi.fn()} onConfirm={vi.fn()} confirming={false} />);
    expect((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value).toBe("800");
  });
});
