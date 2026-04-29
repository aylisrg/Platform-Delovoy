import { describe, it, expect } from "vitest";
import {
  extractPriceList,
  isWeekendDate,
  getResourcePricing,
  calcBookingPrice,
} from "../pricing";

const PL = {
  weekdayHour: 1100,
  weekdayDay: 11000,
  weekendHour: 1400,
  weekendDay: 14000,
};

describe("extractPriceList", () => {
  it("returns priceList from metadata when valid", () => {
    expect(extractPriceList({ priceList: PL }, 1100)).toEqual(PL);
  });

  it("falls back to pricePerHour when metadata has no priceList", () => {
    expect(extractPriceList(null, 800)).toEqual({
      weekdayHour: 800,
      weekdayDay: 8000,
      weekendHour: 800,
      weekendDay: 8000,
    });
  });

  it("returns null when no metadata and no price", () => {
    expect(extractPriceList(null, null)).toBeNull();
    expect(extractPriceList({}, 0)).toBeNull();
  });

  it("ignores malformed priceList in metadata", () => {
    const result = extractPriceList({ priceList: { weekdayHour: 100 } }, 500);
    expect(result?.weekdayHour).toBe(500); // fell back to pricePerHour
  });
});

describe("isWeekendDate", () => {
  it("treats Fri/Sat/Sun as weekend", () => {
    expect(isWeekendDate("2026-05-01")).toBe(true);  // Fri
    expect(isWeekendDate("2026-05-02")).toBe(true);  // Sat
    expect(isWeekendDate("2026-05-03")).toBe(true);  // Sun
  });

  it("treats Mon-Thu as weekday", () => {
    expect(isWeekendDate("2026-04-27")).toBe(false); // Mon
    expect(isWeekendDate("2026-04-28")).toBe(false); // Tue
    expect(isWeekendDate("2026-04-29")).toBe(false); // Wed
    expect(isWeekendDate("2026-04-30")).toBe(false); // Thu
  });
});

describe("getResourcePricing", () => {
  it("picks weekday rates on Wednesday", () => {
    const p = getResourcePricing({ priceList: PL }, 1100, "2026-04-29");
    expect(p?.isWeekend).toBe(false);
    expect(p?.hourRate).toBe(1100);
    expect(p?.dayRate).toBe(11000);
  });

  it("picks weekend rates on Saturday", () => {
    const p = getResourcePricing({ priceList: PL }, 1100, "2026-05-02");
    expect(p?.isWeekend).toBe(true);
    expect(p?.hourRate).toBe(1400);
    expect(p?.dayRate).toBe(14000);
  });
});

describe("calcBookingPrice", () => {
  const weekday = getResourcePricing({ priceList: PL }, 1100, "2026-04-29")!;
  const weekend = getResourcePricing({ priceList: PL }, 1100, "2026-05-02")!;

  it("uses hourly when cheaper", () => {
    const r = calcBookingPrice(weekday, 5);
    expect(r.total).toBe(5500);
    expect(r.appliedDayRate).toBe(false);
    expect(r.savings).toBe(0);
  });

  it("switches to day rate when hourly exceeds dayRate (weekday №1, 11h)", () => {
    const r = calcBookingPrice(weekday, 11);
    expect(r.hourlyTotal).toBe(12100);
    expect(r.total).toBe(11000);
    expect(r.appliedDayRate).toBe(true);
    expect(r.savings).toBe(1100);
  });

  it("switches to day rate at the break-even point (weekday №2 8×800=6400 vs 7000 — keep hourly)", () => {
    const pl2 = { weekdayHour: 800, weekdayDay: 7000, weekendHour: 1000, weekendDay: 10000 };
    const w = getResourcePricing({ priceList: pl2 }, 800, "2026-04-29")!;
    const r = calcBookingPrice(w, 8);
    expect(r.total).toBe(6400);
    expect(r.appliedDayRate).toBe(false);
  });

  it("applies weekend day rate at 11h+ on Sat", () => {
    const r = calcBookingPrice(weekend, 11);
    expect(r.hourlyTotal).toBe(15400);
    expect(r.total).toBe(14000);
    expect(r.appliedDayRate).toBe(true);
  });

  it("equal hourly == dayRate keeps hourly (no savings)", () => {
    // 10h × 1100 = 11000 == weekdayDay
    const r = calcBookingPrice(weekday, 10);
    expect(r.total).toBe(11000);
    expect(r.appliedDayRate).toBe(false);
  });
});
