import { describe, it, expect } from "vitest";
import {
  createSkuSchema,
  updateSkuSchema,
  receiveSchema,
  adjustSchema,
  transactionFilterSchema,
  bookingItemSchema,
  bookingItemsArraySchema,
  createSupplierSchema,
  createStockReceiptSchema,
  createWriteOffSchema,
  auditCountsSchema,
  movementFilterSchema,
  flagProblemSchema,
  editReceiptSchema,
  pendingReceiptsFilterSchema,
  receiptFilterSchema,
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

  it("accepts receipt with valid past receivedAt", () => {
    const result = receiveSchema.safeParse({ name: "Вода", quantity: 10, receivedAt: "2026-04-11" });
    expect(result.success).toBe(true);
  });

  it("accepts receipt without receivedAt (optional)", () => {
    const result = receiveSchema.safeParse({ name: "Вода", quantity: 5 });
    expect(result.success).toBe(true);
  });

  it("rejects future receivedAt", () => {
    const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const result = receiveSchema.safeParse({ name: "Вода", quantity: 5, receivedAt: future });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("будущем");
  });

  it("rejects receivedAt with wrong format", () => {
    const result = receiveSchema.safeParse({ name: "Вода", quantity: 5, receivedAt: "11-04-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 200 chars", () => {
    const result = receiveSchema.safeParse({ name: "A".repeat(201), quantity: 1 });
    expect(result.success).toBe(false);
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

// ============================================================
// V2 Schemas
// ============================================================

describe("createSupplierSchema", () => {
  it("accepts valid supplier", () => {
    const result = createSupplierSchema.safeParse({
      name: "ООО Снабжение",
      contactName: "Иванов",
      phone: "+79001234567",
      email: "info@supply.ru",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createSupplierSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = createSupplierSchema.safeParse({ name: "Поставщик", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string email (treated as optional)", () => {
    const result = createSupplierSchema.safeParse({ name: "Поставщик", email: "" });
    expect(result.success).toBe(true);
  });
});

describe("createStockReceiptSchema", () => {
  it("accepts valid receipt with one item", () => {
    const result = createStockReceiptSchema.safeParse({
      receivedAt: "2026-04-10",
      items: [{ skuId: "sku1", quantity: 10, costPerUnit: 50 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid moduleSlug", () => {
    const result = createStockReceiptSchema.safeParse({
      receivedAt: "2026-04-10",
      moduleSlug: "cafe",
      items: [{ skuId: "sku1", quantity: 5 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid moduleSlug", () => {
    const result = createStockReceiptSchema.safeParse({
      receivedAt: "2026-04-10",
      moduleSlug: "rental",
      items: [{ skuId: "sku1", quantity: 5 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty items array", () => {
    const result = createStockReceiptSchema.safeParse({
      receivedAt: "2026-04-10",
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = createStockReceiptSchema.safeParse({
      receivedAt: "10/04/2026",
      items: [{ skuId: "sku1", quantity: 5 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity in item", () => {
    const result = createStockReceiptSchema.safeParse({
      receivedAt: "2026-04-10",
      items: [{ skuId: "sku1", quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createWriteOffSchema", () => {
  it("accepts valid write-off", () => {
    const result = createWriteOffSchema.safeParse({
      skuId: "sku1",
      quantity: 3,
      reason: "EXPIRED",
    });
    expect(result.success).toBe(true);
  });

  it("rejects reason OTHER without note", () => {
    const result = createWriteOffSchema.safeParse({
      skuId: "sku1",
      quantity: 1,
      reason: "OTHER",
    });
    expect(result.success).toBe(false);
  });

  it("accepts reason OTHER with note", () => {
    const result = createWriteOffSchema.safeParse({
      skuId: "sku1",
      quantity: 1,
      reason: "OTHER",
      note: "Причина указана",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid reason", () => {
    const result = createWriteOffSchema.safeParse({
      skuId: "sku1",
      quantity: 1,
      reason: "STOLEN",
    });
    expect(result.success).toBe(false);
  });
});

describe("auditCountsSchema", () => {
  it("accepts valid counts", () => {
    const result = auditCountsSchema.safeParse({
      counts: [
        { skuId: "sku1", actualQty: 10 },
        { skuId: "sku2", actualQty: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty counts array", () => {
    const result = auditCountsSchema.safeParse({ counts: [] });
    expect(result.success).toBe(false);
  });

  it("rejects negative actualQty", () => {
    const result = auditCountsSchema.safeParse({
      counts: [{ skuId: "sku1", actualQty: -1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("movementFilterSchema", () => {
  it("accepts valid movement type", () => {
    const result = movementFilterSchema.safeParse({ type: "SALE" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid movement type", () => {
    const result = movementFilterSchema.safeParse({ type: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("defaults page and perPage", () => {
    const result = movementFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.page).toBe(1);
    expect(result.data?.perPage).toBe(50);
  });

  it("accepts CORRECTION referenceType", () => {
    const result = movementFilterSchema.safeParse({ referenceType: "CORRECTION" });
    expect(result.success).toBe(true);
  });
});

describe("flagProblemSchema", () => {
  it("accepts valid problem note", () => {
    const result = flagProblemSchema.safeParse({ problemNote: "Не совпадает количество" });
    expect(result.success).toBe(true);
  });

  it("rejects note shorter than 10 chars", () => {
    const result = flagProblemSchema.safeParse({ problemNote: "Короткий" });
    expect(result.success).toBe(false);
  });

  it("rejects missing problemNote", () => {
    const result = flagProblemSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects note longer than 2000 chars", () => {
    const result = flagProblemSchema.safeParse({ problemNote: "a".repeat(2001) });
    expect(result.success).toBe(false);
  });
});

describe("editReceiptSchema", () => {
  it("accepts empty object (all optional)", () => {
    const result = editReceiptSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update", () => {
    const result = editReceiptSchema.safeParse({
      invoiceNumber: "INV-001",
      receivedAt: "2026-04-10",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null supplierId", () => {
    const result = editReceiptSchema.safeParse({ supplierId: null });
    expect(result.success).toBe(true);
  });

  it("rejects items with zero quantity", () => {
    const result = editReceiptSchema.safeParse({
      items: [{ skuId: "sku1", quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("pendingReceiptsFilterSchema", () => {
  it("accepts valid moduleSlug", () => {
    const result = pendingReceiptsFilterSchema.safeParse({ moduleSlug: "bbq" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = pendingReceiptsFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid moduleSlug", () => {
    const result = pendingReceiptsFilterSchema.safeParse({ moduleSlug: "rental" });
    expect(result.success).toBe(false);
  });
});

describe("receiptFilterSchema", () => {
  it("accepts status filter", () => {
    const result = receiptFilterSchema.safeParse({ status: "DRAFT" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid statuses", () => {
    for (const status of ["DRAFT", "CONFIRMED", "PROBLEM", "CORRECTED"]) {
      const result = receiptFilterSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = receiptFilterSchema.safeParse({ status: "PENDING" });
    expect(result.success).toBe(false);
  });
});
