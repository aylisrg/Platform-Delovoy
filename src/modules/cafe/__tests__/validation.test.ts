import { describe, it, expect } from "vitest";
import {
  createMenuItemSchema,
  updateMenuItemSchema,
  createOrderSchema,
  orderFilterSchema,
} from "@/modules/cafe/validation";

describe("createMenuItemSchema", () => {
  it("accepts valid input", () => {
    const result = createMenuItemSchema.safeParse({
      category: "Напитки",
      name: "Кофе Латте",
      price: 250,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = createMenuItemSchema.safeParse({
      category: "Пицца",
      name: "Маргарита",
      description: "Классическая пицца",
      price: 650,
      imageUrl: "https://example.com/pizza.jpg",
      sortOrder: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty category", () => {
    const result = createMenuItemSchema.safeParse({
      category: "",
      name: "Кофе",
      price: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createMenuItemSchema.safeParse({
      category: "Напитки",
      name: "",
      price: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero price", () => {
    const result = createMenuItemSchema.safeParse({
      category: "Напитки",
      name: "Вода",
      price: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative price", () => {
    const result = createMenuItemSchema.safeParse({
      category: "Напитки",
      name: "Вода",
      price: -50,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid imageUrl", () => {
    const result = createMenuItemSchema.safeParse({
      category: "Напитки",
      name: "Вода",
      price: 50,
      imageUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateMenuItemSchema", () => {
  it("accepts partial update (only isAvailable)", () => {
    const result = updateMenuItemSchema.safeParse({ isAvailable: false });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (all optional)", () => {
    const result = updateMenuItemSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects negative price in update", () => {
    const result = updateMenuItemSchema.safeParse({ price: -1 });
    expect(result.success).toBe(false);
  });
});

describe("createOrderSchema", () => {
  it("accepts valid order with one item", () => {
    const result = createOrderSchema.safeParse({
      items: [{ menuItemId: "item-1", quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts order with deliveryTo and comment", () => {
    const result = createOrderSchema.safeParse({
      items: [{ menuItemId: "item-1", quantity: 1 }],
      deliveryTo: "305",
      comment: "Без острого",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty items array", () => {
    const result = createOrderSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const result = createOrderSchema.safeParse({
      items: [{ menuItemId: "item-1", quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = createOrderSchema.safeParse({
      items: [{ menuItemId: "item-1", quantity: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing items field", () => {
    const result = createOrderSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("orderFilterSchema", () => {
  it("accepts empty filter", () => {
    const result = orderFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid status filter", () => {
    const result = orderFilterSchema.safeParse({ status: "NEW" });
    expect(result.success).toBe(true);
  });

  it("accepts valid date range", () => {
    const result = orderFilterSchema.safeParse({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = orderFilterSchema.safeParse({ status: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects wrong date format", () => {
    const result = orderFilterSchema.safeParse({ dateFrom: "01-01-2026" });
    expect(result.success).toBe(false);
  });
});
