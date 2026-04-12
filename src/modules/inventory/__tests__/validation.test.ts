import { describe, it, expect } from "vitest";
import {
  createSkuSchema,
  updateSkuSchema,
  receiveSchema,
  adjustSchema,
  transactionFilterSchema,
  bookingItemSchema,
  bookingItemsArraySchema,
} from "../validation";

describe("createSkuSchema", () => {
  it("accepts valid SKU", () => {
    const result = createSkuSchema.safeParse({
      name: "Coca-Cola",
      category: "Напитки",
      price: 150,
    });
    expect(result.success).toBe(true);
    expect(result.data?.unit).toBe("шт");
    expect(result.data?.lowStockThreshold).toBe(5);
  });

  it("rejects empty name", () => {
    const result = createSkuSchema.safeParse({
      name: "",
      category: "Напитки",
      price: 150,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive price", () => {
    const result = createSkuSchema.safeParse({
      name: "Cola",
      category: "Напитки",
      price: -10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative initialStock", () => {
    const result = createSkuSchema.safeParse({
      name: "Cola",
      category: "Напитки",
      price: 150,
      initialStock: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("updateSkuSchema", () => {
  it("accepts partial update", () => {
    const result = updateSkuSchema.safeParse({ price: 200 });
    expect(result.success).toBe(true);
  });

  it("accepts isActive toggle", () => {
    const result = updateSkuSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });
});

describe("receiveSchema", () => {
  it("accepts valid receipt with name", () => {
    const result = receiveSchema.safeParse({ name: "Coca-Cola 0.5л", quantity: 10 });
    expect(result.success).toBe(true);
  });

  it("accepts receipt with optional note", () => {
    const result = receiveSchema.safeParse({ name: "Pepsi", quantity: 24, note: "Накладная №5" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = receiveSchema.safeParse({ name: "", quantity: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const result = receiveSchema.safeParse({ name: "Вода", quantity: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = receiveSchema.safeParse({ name: "Вода", quantity: -5 });
    expect(result.success).toBe(false);
  });
});

describe("adjustSchema", () => {
  it("accepts valid adjustment", () => {
    const result = adjustSchema.safeParse({
      skuId: "abc",
      targetQuantity: 50,
      note: "Инвентаризация",
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative targetQuantity", () => {
    const result = adjustSchema.safeParse({
      skuId: "abc",
      targetQuantity: -1,
      note: "Инвентаризация",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty note", () => {
    const result = adjustSchema.safeParse({
      skuId: "abc",
      targetQuantity: 10,
      note: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("transactionFilterSchema", () => {
  it("applies defaults", () => {
    const result = transactionFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.page).toBe(1);
    expect(result.data?.perPage).toBe(50);
  });

  it("rejects invalid transaction type", () => {
    const result = transactionFilterSchema.safeParse({ type: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = transactionFilterSchema.safeParse({ dateFrom: "01-04-2026" });
    expect(result.success).toBe(false);
  });

  it("accepts valid date format", () => {
    const result = transactionFilterSchema.safeParse({ dateFrom: "2026-04-01" });
    expect(result.success).toBe(true);
  });
});

describe("bookingItemSchema", () => {
  it("accepts valid item", () => {
    const result = bookingItemSchema.safeParse({ skuId: "abc", quantity: 3 });
    expect(result.success).toBe(true);
  });

  it("rejects zero quantity", () => {
    const result = bookingItemSchema.safeParse({ skuId: "abc", quantity: 0 });
    expect(result.success).toBe(false);
  });
});

describe("bookingItemsArraySchema", () => {
  it("accepts empty array", () => {
    const result = bookingItemsArraySchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects more than 20 items", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      skuId: `sku${i}`,
      quantity: 1,
    }));
    const result = bookingItemsArraySchema.safeParse(items);
    expect(result.success).toBe(false);
  });
});
