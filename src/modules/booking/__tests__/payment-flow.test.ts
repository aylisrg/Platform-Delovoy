import { describe, it, expect } from "vitest";
import { isHiddenFromStaff } from "../payment-flow";

describe("isHiddenFromStaff", () => {
  it("бронь с сайта, ещё не оплачена — персонал о ней не знает", () => {
    expect(isHiddenFromStaff({ paymentFlow: "online" })).toBe(true);
    expect(isHiddenFromStaff({ paymentFlow: "online", onlinePaidAmount: "0.00" })).toBe(true);
  });

  it("бронь с сайта после оплаты — персонал её видел («оплачена»)", () => {
    expect(isHiddenFromStaff({ paymentFlow: "online", onlinePaidAmount: "4000.00" })).toBe(false);
  });

  it("брони без флага (бот, телефон, созданные до флага) персонал видел всегда", () => {
    expect(isHiddenFromStaff({})).toBe(false);
    expect(isHiddenFromStaff(null)).toBe(false);
    expect(isHiddenFromStaff({ paymentFlow: "link" })).toBe(false);
  });
});
