import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    inventorySku: {
      findMany: vi.fn(),
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
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  listPublicSkus,
  createSku,
  receiveStock,
  adjustStock,
  voidTransaction,
  validateAndSnapshotItems,
  InventoryError,
  getHealth,
} from "../service";

const mockPrisma = prisma as unknown as {
  inventorySku: {
    findMany: ReturnType<typeof vi.fn>;
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
