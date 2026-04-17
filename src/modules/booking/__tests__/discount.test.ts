import { describe, it, expect } from "vitest";
import { applyDiscount, DISCOUNT_REASONS, DISCOUNT_REASON_LABELS, DEFAULT_MAX_DISCOUNT_PERCENT } from "../discount";

describe("applyDiscount", () => {
  it("calculates 10% discount on 1000", () => {
    const result = applyDiscount(1000, 10);
    expect(result.discountAmount).toBe(100);
    expect(result.finalAmount).toBe(900);
  });

  it("calculates 30% discount on 1667 (rounds to nearest integer)", () => {
    const result = applyDiscount(1667, 30);
    expect(result.discountAmount).toBe(500); // Math.round(1667 * 30 / 100) = 500
    expect(result.finalAmount).toBe(1167);
  });

  it("calculates 15% discount on 333 (rounding edge case)", () => {
    const result = applyDiscount(333, 15);
    expect(result.discountAmount).toBe(50); // Math.round(333 * 15 / 100) = Math.round(49.95) = 50
    expect(result.finalAmount).toBe(283);
  });

  it("returns 0 discount for 0 amount", () => {
    const result = applyDiscount(0, 20);
    expect(result.discountAmount).toBe(0);
    expect(result.finalAmount).toBe(0);
  });

  it("handles 1% discount on small amount", () => {
    const result = applyDiscount(100, 1);
    expect(result.discountAmount).toBe(1);
    expect(result.finalAmount).toBe(99);
  });

  it("handles 99% discount", () => {
    const result = applyDiscount(1000, 99);
    expect(result.discountAmount).toBe(990);
    expect(result.finalAmount).toBe(10);
  });

  it("handles 50% discount exactly", () => {
    const result = applyDiscount(500, 50);
    expect(result.discountAmount).toBe(250);
    expect(result.finalAmount).toBe(250);
  });

  it("discountAmount + finalAmount === originalAmount", () => {
    const amounts = [100, 333, 500, 999, 1667, 5000, 12345];
    const percents = [1, 5, 10, 15, 20, 25, 30, 50, 75, 99];
    for (const amount of amounts) {
      for (const pct of percents) {
        const result = applyDiscount(amount, pct);
        expect(result.discountAmount + result.finalAmount).toBe(amount);
      }
    }
  });
});

describe("DISCOUNT_REASONS", () => {
  it("has 5 reasons", () => {
    expect(DISCOUNT_REASONS).toHaveLength(5);
  });

  it("includes expected values", () => {
    expect(DISCOUNT_REASONS).toContain("permanent_client");
    expect(DISCOUNT_REASONS).toContain("corporate");
    expect(DISCOUNT_REASONS).toContain("promo");
    expect(DISCOUNT_REASONS).toContain("compensation");
    expect(DISCOUNT_REASONS).toContain("other");
  });

  it("each reason has a Russian label", () => {
    for (const reason of DISCOUNT_REASONS) {
      expect(DISCOUNT_REASON_LABELS[reason]).toBeTruthy();
      expect(typeof DISCOUNT_REASON_LABELS[reason]).toBe("string");
    }
  });
});

describe("DEFAULT_MAX_DISCOUNT_PERCENT", () => {
  it("is 30", () => {
    expect(DEFAULT_MAX_DISCOUNT_PERCENT).toBe(30);
  });
});
