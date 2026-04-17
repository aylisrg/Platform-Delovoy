import { describe, it, expect } from "vitest";
import { checkoutDiscountSchema } from "../validation";

describe("checkoutDiscountSchema", () => {
  it("accepts valid discount with reason", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "permanent_client",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountPercent).toBe(10);
      expect(result.data.discountReason).toBe("permanent_client");
    }
  });

  it("accepts all valid reasons", () => {
    const reasons = ["permanent_client", "corporate", "promo", "compensation", "other"];
    for (const reason of reasons) {
      const result = checkoutDiscountSchema.safeParse({
        discountPercent: 5,
        discountReason: reason,
        ...(reason === "other" && { discountNote: "Тестовая причина" }),
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts discount with note for 'other' reason", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
      discountNote: "Клиент помог с организацией мероприятия",
    });
    expect(result.success).toBe(true);
  });

  it("rejects 'other' reason without note", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
    });
    expect(result.success).toBe(false);
  });

  it("rejects 'other' reason with note shorter than 5 chars", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
      discountNote: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("accepts 'other' with exactly 5 chars note", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 15,
      discountReason: "other",
      discountNote: "абвгд",
    });
    expect(result.success).toBe(true);
  });

  it("rejects discountPercent = 0", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 0,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative discountPercent", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: -5,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects discountPercent > 100", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 150,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer discountPercent", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10.5,
      discountReason: "promo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid discount reason", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "invalid_reason",
    });
    expect(result.success).toBe(false);
  });

  it("rejects note longer than 500 chars", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "other",
      discountNote: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts note at exactly 500 chars", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "other",
      discountNote: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });

  it("does not require note for non-other reasons", () => {
    const result = checkoutDiscountSchema.safeParse({
      discountPercent: 10,
      discountReason: "permanent_client",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountNote).toBeUndefined();
    }
  });
});
