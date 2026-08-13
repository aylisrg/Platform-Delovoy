import { describe, expect, it } from "vitest";
import { getBookingPaymentSummary } from "../payment-status";

/** toLocaleString("ru-RU") разделяет разряды неразрывным пробелом. */
const normalizeSpaces = (s: string) => s.replace(/\u00a0|\u202f/g, " ");

describe("getBookingPaymentSummary", () => {
  it("складывает кассу, карту и онлайн в одну сумму — один индикатор, а не три (AC-6)", () => {
    const summary = getBookingPaymentSummary({
      status: "CONFIRMED",
      cashAmount: 1000,
      cardAmount: 2000,
      metadata: { totalPrice: "8000", onlinePaidAmount: "5000" },
    });

    expect(summary.paid).toBe(8000);
    expect(summary.state).toBe("PAID");
    expect(summary.label).toBe("ОПЛАЧЕНО");
  });

  it("считает оплаченной бронь, закрытую полностью только онлайн-предоплатой", () => {
    const summary = getBookingPaymentSummary({
      status: "CONFIRMED",
      metadata: { totalPrice: "3000", onlinePaidAmount: "3000" },
    });

    expect(summary.state).toBe("PAID");
    expect(summary.outstanding).toBe(0);
  });

  it("частичная оплата показывает и полученное, и общую сумму", () => {
    const summary = getBookingPaymentSummary({
      status: "CONFIRMED",
      metadata: { totalPrice: "8000", onlinePaidAmount: "2000" },
    });

    expect(summary.state).toBe("PARTIAL");
    expect(summary.outstanding).toBe(6000);
    expect(normalizeSpaces(summary.label)).toContain("2 000");
    expect(normalizeSpaces(summary.label)).toContain("8 000");
  });

  it("бронь без единого платежа — «Не оплачено» с суммой счёта", () => {
    const summary = getBookingPaymentSummary({
      status: "PENDING",
      metadata: { totalPrice: "1500" },
    });

    expect(summary.state).toBe("UNPAID");
    expect(summary.paid).toBe(0);
    expect(normalizeSpaces(summary.label)).toContain("1 500");
  });

  it("завершённая бронь после чекаута оплачена — платёжный гейт не пускает иначе (AC-4)", () => {
    const summary = getBookingPaymentSummary({
      status: "COMPLETED",
      cashAmount: 8000,
      cardAmount: 0,
      metadata: { totalPrice: "8000" },
    });

    expect(summary.state).toBe("PAID");
  });

  it("отменённая бронь с удержанным штрафом — не «ОПЛАЧЕНО», услуги не было (AC-5)", () => {
    const summary = getBookingPaymentSummary({
      status: "CANCELLED",
      metadata: {
        totalPrice: "6000",
        onlinePaidAmount: "6000",
        cancelPenalty: { amount: "6000", reason: "late", appliedAt: "2026-08-13T10:00:00Z" },
      },
    });

    expect(summary.state).toBe("PENALTY_HELD");
    expect(summary.label).toContain("Штраф удержан");
    expect(summary.penalty).toBe(6000);
  });

  it("отменённая бронь без штрафа не превращается в PENALTY_HELD", () => {
    const summary = getBookingPaymentSummary({
      status: "CANCELLED",
      metadata: { totalPrice: "6000" },
    });

    expect(summary.state).toBe("UNPAID");
  });

  it("итог берётся из скидки, когда totalPrice не пересчитан", () => {
    const summary = getBookingPaymentSummary({
      status: "CONFIRMED",
      cashAmount: 7200,
      metadata: {
        totalPrice: "8000",
        discount: {
          percent: 10,
          amount: "800",
          originalAmount: "8000",
          finalAmount: "7200",
          reason: "loyalty",
          appliedBy: "u1",
          appliedAt: "2026-08-13T10:00:00Z",
        },
      },
    });

    expect(summary.totalDue).toBe(7200);
    expect(summary.state).toBe("PAID");
  });

  it("бесплатная бронь без счёта не выглядит должником", () => {
    const summary = getBookingPaymentSummary({ status: "CONFIRMED", metadata: {} });

    expect(summary.state).toBe("FREE");
    expect(summary.shortLabel).toBe("");
  });

  it("переваривает Decimal из Prisma, а не только числа", () => {
    const decimal = { toString: () => "2500.00" };
    const summary = getBookingPaymentSummary({
      status: "COMPLETED",
      cashAmount: decimal,
      cardAmount: decimal,
      metadata: { totalPrice: "5000" },
    });

    expect(summary.paid).toBe(5000);
    expect(summary.state).toBe("PAID");
  });
});
