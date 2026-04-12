import { describe, it, expect } from "vitest";
import { computeBookingPricing } from "../pricing";

const makeTime = (dateStr: string, hour: number): Date =>
  new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00`);

describe("computeBookingPricing", () => {
  it("computes basePrice for 1-hour booking at 300/hour", () => {
    const result = computeBookingPricing(
      makeTime("2030-08-20", 12),
      makeTime("2030-08-20", 13),
      300,
      0
    );
    expect(result.basePrice).toBe("300.00");
    expect(result.pricePerHour).toBe("300.00");
    expect(result.totalPrice).toBe("300.00");
  });

  it("computes basePrice for 3-hour booking", () => {
    const result = computeBookingPricing(
      makeTime("2030-08-20", 10),
      makeTime("2030-08-20", 13),
      200,
      0
    );
    expect(result.basePrice).toBe("600.00");
    expect(result.totalPrice).toBe("600.00");
  });

  it("adds itemsTotal to totalPrice", () => {
    const result = computeBookingPricing(
      makeTime("2030-08-20", 12),
      makeTime("2030-08-20", 13),
      300,
      150 // items
    );
    expect(result.basePrice).toBe("300.00");
    expect(result.totalPrice).toBe("450.00");
  });

  it("returns zero basePrice when pricePerHour is null", () => {
    const result = computeBookingPricing(
      makeTime("2030-08-20", 12),
      makeTime("2030-08-20", 13),
      null,
      0
    );
    expect(result.basePrice).toBe("0.00");
    expect(result.pricePerHour).toBe("0.00");
    expect(result.totalPrice).toBe("0.00");
  });

  it("returns correct totalPrice when pricePerHour is null but itemsTotal > 0", () => {
    const result = computeBookingPricing(
      makeTime("2030-08-20", 12),
      makeTime("2030-08-20", 13),
      null,
      200
    );
    expect(result.basePrice).toBe("0.00");
    expect(result.totalPrice).toBe("200.00");
  });

  it("snapshots pricePerHour value in result", () => {
    const result = computeBookingPricing(
      makeTime("2030-08-20", 12),
      makeTime("2030-08-20", 14),
      450,
      0
    );
    expect(result.pricePerHour).toBe("450.00");
    expect(result.basePrice).toBe("900.00");
  });
});
