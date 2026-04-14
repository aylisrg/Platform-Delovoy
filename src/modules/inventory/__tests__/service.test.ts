import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    inventorySku: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    inventoryTransaction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  listPublicSkus,
  createSku,
  receiveStock,
  receiveStockByName,
  listReceipts,
  adjustStock,
  voidTransaction,
  validateAndSnapshotItems,
  InventoryError,
  getHealth,
} from "../service";

const mockPrisma = prisma as unknown as {
  inventorySku: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  inventoryTransaction: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: {
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPublicSkus", () => {
  it("returns active SKUs", async () => {
    const mockSkus = [
      {
        id: "sku1",
        name: "Cola",
        category: "Напитки",
        unit: "шт",
        price: "150",
        stockQuantity: 10,
        isActive: true,
      },
    ];
    mockPrisma.inventorySku.findMany.mockResolvedValue(mockSkus);

    const result = await listPublicSkus();

    expect(mockPrisma.inventorySku.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
    expect(result).toEqual(mockSkus);
  });
});

describe("createSku", () => {
  it("creates SKU without initial stock", async () => {
    const mockSku = {
      id: "sku1",
      name: "Cola",
      category: "Напитки",
      unit: "шт",
      price: "150",
      stockQuantity: 0,
      lowStockThreshold: 5,
      isActive: true,
    };

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        inventorySku: { create: vi.fn().mockResolvedValue(mockSku) },
        inventoryTransaction: { create: vi.fn() },
      };
      return fn(tx);
    });

    const result = await createSku(
      { name: "Cola", category: "Напитки", price: 150 },
      "user1"
    );

    expect(result).toEqual(mockSku);
  });

  it("creates SKU with initial stock and INITIAL transaction", async () => {
    const mockSku = {
      id: "sku1",
      name: "Cola",
      category: "Напитки",
      stockQuantity: 50,
    };

    const txInventorySku = { create: vi.fn().mockResolvedValue(mockSku) };
    const txInventoryTransaction = { create: vi.fn().mockResolvedValue({ id: "txn1" }) };

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        inventorySku: txInventorySku,
        inventoryTransaction: txInventoryTransaction,
      });
    });

    await createSku(
      { name: "Cola", category: "Напитки", price: 150, initialStock: 50 },
      "user1"
    );

    expect(txInventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "INITIAL", quantity: 50 }) })
    );
  });
});

describe("receiveStock", () => {
  it("throws when SKU not found", async () => {
    mockPrisma.inventorySku.findUnique.mockResolvedValue(null);

    await expect(
      receiveStock({ skuId: "sku1", quantity: 10 }, "user1")
    ).rejects.toMatchObject({ code: "SKU_NOT_FOUND" });
  });

  it("throws when SKU is inactive", async () => {
    mockPrisma.inventorySku.findUnique.mockResolvedValue({ id: "sku1", isActive: false });

    await expect(
      receiveStock({ skuId: "sku1", quantity: 10 }, "user1")
    ).rejects.toMatchObject({ code: "SKU_NOT_FOUND" });
  });

  it("creates RECEIPT transaction and increments stock", async () => {
    const mockSku = { id: "sku1", isActive: true, stockQuantity: 5 };
    mockPrisma.inventorySku.findUnique.mockResolvedValue(mockSku);

    const txCreate = vi.fn().mockResolvedValue({ id: "txn1" });
    const txUpdate = vi.fn().mockResolvedValue({ stockQuantity: 15 });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        inventoryTransaction: { create: txCreate },
        inventorySku: { update: txUpdate },
      });
    });

    const result = await receiveStock({ skuId: "sku1", quantity: 10 }, "user1");

    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "RECEIPT", quantity: 10 }),
      })
    );
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stockQuantity: { increment: 10 } },
      })
    );
    expect(result.newStockQuantity).toBe(15);
  });
});

describe("adjustStock", () => {
  it("throws when SKU not found", async () => {
    mockPrisma.inventorySku.findUnique.mockResolvedValue(null);

    await expect(
      adjustStock({ skuId: "sku1", targetQuantity: 10, note: "Инвентаризация" }, "user1")
    ).rejects.toMatchObject({ code: "SKU_NOT_FOUND" });
  });

  it("throws when no change needed", async () => {
    mockPrisma.inventorySku.findUnique.mockResolvedValue({ id: "sku1", stockQuantity: 10 });

    await expect(
      adjustStock({ skuId: "sku1", targetQuantity: 10, note: "Инвентаризация" }, "user1")
    ).rejects.toMatchObject({ code: "NO_CHANGE" });
  });

  it("creates ADJUSTMENT transaction with correct delta", async () => {
    mockPrisma.inventorySku.findUnique.mockResolvedValue({ id: "sku1", stockQuantity: 12 });

    const txCreate = vi.fn().mockResolvedValue({ id: "txn1" });
    const txUpdate = vi.fn().mockResolvedValue({ stockQuantity: 10 });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        inventoryTransaction: { create: txCreate },
        inventorySku: { update: txUpdate },
      });
    });

    const result = await adjustStock(
      { skuId: "sku1", targetQuantity: 10, note: "Инвентаризация" },
      "user1"
    );

    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "ADJUSTMENT", quantity: 2 }),
      })
    );
    expect(result.delta).toBe(-2);
    expect(result.newStockQuantity).toBe(10);
  });
});

describe("voidTransaction", () => {
  it("throws when transaction not found", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue(null);

    await expect(voidTransaction("txn1", "user1")).rejects.toMatchObject({
      code: "TRANSACTION_NOT_FOUND",
    });
  });

  it("throws when already voided", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "txn1",
      isVoided: true,
      type: "RECEIPT",
      quantity: 10,
      skuId: "sku1",
      sku: { stockQuantity: 5 },
    });

    await expect(voidTransaction("txn1", "user1")).rejects.toMatchObject({
      code: "TRANSACTION_ALREADY_VOIDED",
    });
  });

  it("throws when voiding would make stock negative", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "txn1",
      isVoided: false,
      type: "RECEIPT",
      quantity: 20,
      skuId: "sku1",
      note: null,
      sku: { stockQuantity: 5 },
    });

    await expect(voidTransaction("txn1", "user1")).rejects.toMatchObject({
      code: "STOCK_WOULD_GO_NEGATIVE",
    });
  });
});

describe("validateAndSnapshotItems", () => {
  it("returns empty when no items", async () => {
    const result = await validateAndSnapshotItems([]);
    expect(result).toEqual({ snapshots: [], itemsTotal: 0 });
  });

  it("throws when SKU not found or inactive", async () => {
    mockPrisma.inventorySku.findMany.mockResolvedValue([]);

    await expect(
      validateAndSnapshotItems([{ skuId: "sku1", quantity: 2 }])
    ).rejects.toMatchObject({ code: "INVALID_SKU" });
  });

  it("throws INVENTORY_INSUFFICIENT when stock is low", async () => {
    mockPrisma.inventorySku.findMany.mockResolvedValue([
      { id: "sku1", name: "Cola", price: "150", stockQuantity: 1 },
    ]);

    await expect(
      validateAndSnapshotItems([{ skuId: "sku1", quantity: 5 }])
    ).rejects.toMatchObject({ code: "INVENTORY_INSUFFICIENT" });
  });

  it("returns snapshots and total for valid items", async () => {
    mockPrisma.inventorySku.findMany.mockResolvedValue([
      { id: "sku1", name: "Cola", price: "150", stockQuantity: 10 },
    ]);

    const result = await validateAndSnapshotItems([{ skuId: "sku1", quantity: 2 }]);

    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]).toMatchObject({
      skuId: "sku1",
      skuName: "Cola",
      quantity: 2,
      priceAtBooking: "150",
    });
    expect(result.itemsTotal).toBe(300);
  });
});

describe("receiveStockByName", () => {
  it("creates RECEIPT for existing SKU and passes receivedAt", async () => {
    const existingSku = { id: "sku1", name: "Cola" };
    mockPrisma.inventorySku.findFirst.mockResolvedValue(existingSku);

    const txCreate = vi.fn().mockResolvedValue({ id: "txn1" });
    const txUpdate = vi.fn().mockResolvedValue({ stockQuantity: 30 });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        inventoryTransaction: { create: txCreate },
        inventorySku: { update: txUpdate, create: vi.fn() },
        stockBatch: { create: vi.fn().mockResolvedValue({ id: "batch1" }) },
        stockMovement: { create: vi.fn().mockResolvedValue({ id: "mov1" }) },
      });
    });

    const receivedAt = new Date("2026-04-11");
    const result = await receiveStockByName("Cola", 10, undefined, "user1", receivedAt);

    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "RECEIPT",
          quantity: 10,
          receivedAt,
        }),
      })
    );
    expect(result.isNewSku).toBe(false);
    expect(result.newStockQuantity).toBe(30);
  });

  it("creates new SKU with INITIAL transaction when not found", async () => {
    mockPrisma.inventorySku.findFirst.mockResolvedValue(null);

    const newSku = { id: "sku2", name: "Pepsi", stockQuantity: 20 };
    const txSkuCreate = vi.fn().mockResolvedValue(newSku);
    const txCreate = vi.fn().mockResolvedValue({ id: "txn2" });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        inventorySku: { create: txSkuCreate, update: vi.fn() },
        inventoryTransaction: { create: txCreate },
        stockBatch: { create: vi.fn().mockResolvedValue({ id: "batch2" }) },
        stockMovement: { create: vi.fn().mockResolvedValue({ id: "mov2" }) },
      });
    });

    const result = await receiveStockByName("Pepsi", 20, "Первая поставка", "user1");

    expect(txSkuCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Pepsi" }) })
    );
    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "INITIAL", quantity: 20 }),
      })
    );
    expect(result.isNewSku).toBe(true);
  });

  it("uses current date when receivedAt is not provided", async () => {
    const existingSku = { id: "sku1", name: "Cola" };
    mockPrisma.inventorySku.findFirst.mockResolvedValue(existingSku);

    const txCreate = vi.fn().mockResolvedValue({ id: "txn1" });
    const txUpdate = vi.fn().mockResolvedValue({ stockQuantity: 10 });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        inventoryTransaction: { create: txCreate },
        inventorySku: { update: txUpdate },
        stockBatch: { create: vi.fn().mockResolvedValue({ id: "batch3" }) },
        stockMovement: { create: vi.fn().mockResolvedValue({ id: "mov3" }) },
      });
    });

    const before = new Date();
    await receiveStockByName("Cola", 5, undefined, "user1");
    const after = new Date();

    const receivedAtArg = txCreate.mock.calls[0][0].data.receivedAt as Date;
    expect(receivedAtArg.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(receivedAtArg.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("listReceipts", () => {
  it("returns receipts with receivedAt as fallback to createdAt for null rows", async () => {
    const now = new Date("2026-04-12T10:00:00Z");
    const past = new Date("2026-04-11T08:00:00Z");

    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        id: "t1",
        skuId: "sku1",
        sku: { name: "Cola" },
        type: "RECEIPT",
        quantity: 10,
        note: "Note A",
        performedById: "user1",
        receivedAt: past,
        createdAt: now,
      },
      {
        id: "t2",
        skuId: "sku2",
        sku: { name: "Pepsi" },
        type: "INITIAL",
        quantity: 5,
        note: null,
        performedById: "user1",
        receivedAt: null, // fallback
        createdAt: now,
      },
    ]);

    mockPrisma.user.findMany.mockResolvedValue([{ id: "user1", name: "Иван" }]);

    const rows = await listReceipts();

    expect(rows).toHaveLength(2);

    // Row with explicit receivedAt
    expect(rows[0].receivedAt).toBe(past.toISOString());

    // Row with null receivedAt → falls back to createdAt
    expect(rows[1].receivedAt).toBe(now.toISOString());

    expect(rows[0].performedByName).toBe("Иван");
    expect(rows[1].note).toBeNull();
  });
});

describe("getHealth", () => {
  it("returns health status", async () => {
    mockPrisma.inventorySku.count.mockResolvedValueOnce(15);
    mockPrisma.inventorySku.count.mockResolvedValueOnce(14);
    mockPrisma.inventorySku.findMany.mockResolvedValue([
      { stockQuantity: 3, lowStockThreshold: 5 },
      { stockQuantity: 10, lowStockThreshold: 5 },
    ]);

    const result = await getHealth();

    expect(result.status).toBe("ok");
    expect(result.totalSkus).toBe(15);
    expect(result.activeSkus).toBe(14);
    expect(result.lowStockCount).toBe(1);
  });
});
