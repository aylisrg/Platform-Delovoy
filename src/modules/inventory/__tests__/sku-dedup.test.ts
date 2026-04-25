import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Mock side-effect modules so importing the service doesn't trigger Telegram, etc.
vi.mock("../alerts", () => ({
  checkAndSendLowStockAlert: vi.fn().mockResolvedValue(undefined),
  runLowStockAlertSweep: vi.fn().mockResolvedValue({ checked: 0, alerted: 0 }),
}));

vi.mock("../notifications", () => ({
  notifyModuleAdmins: vi.fn().mockResolvedValue(undefined),
  notifyUser: vi.fn().mockResolvedValue(undefined),
  buildReceiptCreatedMessage: vi.fn().mockReturnValue("created"),
  buildReceiptConfirmedMessage: vi.fn().mockReturnValue("confirmed"),
  buildReceiptProblemMessage: vi.fn().mockReturnValue("problem"),
  buildReceiptCorrectedMessage: vi.fn().mockReturnValue("corrected"),
  buildNoAdminWarningMessage: vi.fn().mockReturnValue("no-admin"),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    inventorySku: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    inventoryTransaction: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    stockBatch: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    stockReceiptItem: {
      updateMany: vi.fn(),
    },
    stockMovement: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    writeOff: {
      updateMany: vi.fn(),
    },
    menuItem: {
      updateMany: vi.fn(),
    },
    inventoryAuditCount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { createSku, mergeSku, InventoryError } from "../service";

type Mocked = ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  inventorySku: {
    findFirst: Mocked;
    findUnique: Mocked;
    create: Mocked;
    update: Mocked;
  };
  inventoryTransaction: {
    create: Mocked;
    updateMany: Mocked;
  };
  stockBatch: {
    create: Mocked;
    update: Mocked;
    findMany: Mocked;
    updateMany: Mocked;
    aggregate: Mocked;
  };
  stockReceiptItem: {
    updateMany: Mocked;
  };
  stockMovement: {
    create: Mocked;
    updateMany: Mocked;
  };
  writeOff: {
    updateMany: Mocked;
  };
  menuItem: {
    updateMany: Mocked;
  };
  inventoryAuditCount: {
    findMany: Mocked;
    findUnique: Mocked;
    update: Mocked;
    delete: Mocked;
  };
  $transaction: Mocked;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// === createSku — name normalization & deduplication ===

describe("createSku — deduplication", () => {
  it('throws SKU_DUPLICATE with existingSkuId when "Red Bull" already exists', async () => {
    mockPrisma.inventorySku.findFirst.mockResolvedValue({
      id: "sku-existing",
      name: "Red Bull",
    });

    await expect(
      createSku({ name: "Red Bull", category: "Напитки", price: 200 }, "user1")
    ).rejects.toMatchObject({
      code: "SKU_DUPLICATE",
      meta: { existingSkuId: "sku-existing", existingSkuName: "Red Bull" },
    });

    // Pre-flight check excludes archived SKUs
    expect(mockPrisma.inventorySku.findFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: "Red Bull", mode: "insensitive" },
        isActive: true,
      },
    });
  });

  it('treats "  Red Bull  " (extra whitespace) as duplicate via normalization', async () => {
    mockPrisma.inventorySku.findFirst.mockResolvedValue({
      id: "sku-existing",
      name: "Red Bull",
    });

    await expect(
      createSku(
        { name: "  Red Bull  ", category: "Напитки", price: 200 },
        "user1"
      )
    ).rejects.toMatchObject({
      code: "SKU_DUPLICATE",
      meta: { existingSkuId: "sku-existing" },
    });

    // The query must use the *normalized* name (trimmed, single spaces)
    expect(mockPrisma.inventorySku.findFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: "Red Bull", mode: "insensitive" },
        isActive: true,
      },
    });
  });

  it('treats "red bull" (different case) as duplicate via case-insensitive lookup', async () => {
    mockPrisma.inventorySku.findFirst.mockResolvedValue({
      id: "sku-existing",
      name: "Red Bull",
    });

    await expect(
      createSku({ name: "red bull", category: "Напитки", price: 200 }, "user1")
    ).rejects.toMatchObject({
      code: "SKU_DUPLICATE",
      meta: { existingSkuId: "sku-existing", existingSkuName: "Red Bull" },
    });

    // Mode must be insensitive
    expect(mockPrisma.inventorySku.findFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: "red bull", mode: "insensitive" },
        isActive: true,
      },
    });
  });

  it('creates "Pepsi" successfully when no duplicate exists, persisting the normalized name', async () => {
    mockPrisma.inventorySku.findFirst.mockResolvedValue(null);

    const txCreate = vi.fn().mockResolvedValue({
      id: "sku-new",
      name: "Pepsi",
      category: "Напитки",
      price: "150",
      stockQuantity: 0,
    });
    const txTransactionCreate = vi.fn();

    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          inventorySku: { create: txCreate, findFirst: vi.fn() },
          inventoryTransaction: { create: txTransactionCreate },
        })
    );

    const result = await createSku(
      // Leading/trailing spaces — exercise normalization end-to-end
      { name: "  Pepsi  ", category: "Напитки", price: 150 },
      "user1"
    );

    expect(result).toMatchObject({ id: "sku-new", name: "Pepsi" });
    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Pepsi" }),
      })
    );
    // No INITIAL transaction when initialStock is not supplied
    expect(txTransactionCreate).not.toHaveBeenCalled();
  });

  it("converts a P2002 race-condition into SKU_DUPLICATE", async () => {
    // First findFirst (pre-flight) returns null — looks free.
    // tx.create rejects with P2002 (concurrent winner). Inner findFirst returns the row.
    mockPrisma.inventorySku.findFirst.mockResolvedValue(null);

    const innerFindFirst = vi.fn().mockResolvedValue({
      id: "sku-race",
      name: "Pepsi",
    });
    const txCreate = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["name"] },
      })
    );

    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          inventorySku: { create: txCreate, findFirst: innerFindFirst },
          inventoryTransaction: { create: vi.fn() },
        })
    );

    await expect(
      createSku({ name: "Pepsi", category: "Напитки", price: 150 }, "user1")
    ).rejects.toMatchObject({
      code: "SKU_DUPLICATE",
      meta: { existingSkuId: "sku-race", existingSkuName: "Pepsi" },
    });
  });
});

// === mergeSku ===

describe("mergeSku", () => {
  it("happy path: archives source, re-points related rows, recalculates target stock", async () => {
    const source = { id: "src", name: "Кола", isActive: true };
    const target = { id: "tgt", name: "Coca-Cola", isActive: true };

    mockPrisma.inventorySku.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "src") return Promise.resolve(source);
        if (where.id === "tgt") return Promise.resolve(target);
        return Promise.resolve(null);
      }
    );

    // After the merge the second getSku(targetId) call returns target with new stock.
    // The implementation calls getSku(targetId) AFTER the transaction; we'll rebind the mock.
    const txStockBatchUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txReceiptItemUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txMovementUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txInventoryTxUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const txWriteOffUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txMenuItemUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txAuditCountFindMany = vi.fn().mockResolvedValue([]);
    const txSkuUpdate = vi.fn().mockResolvedValue({ id: "src", isActive: false });
    const txBatchAggregate = vi
      .fn()
      .mockResolvedValue({ _sum: { remainingQty: 42 }, _count: 1 });
    const txInnerSkuUpdate = vi.fn().mockResolvedValue({ stockQuantity: 42 });

    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          stockBatch: {
            updateMany: txStockBatchUpdateMany,
            aggregate: txBatchAggregate,
          },
          stockReceiptItem: { updateMany: txReceiptItemUpdateMany },
          stockMovement: { updateMany: txMovementUpdateMany },
          inventoryTransaction: { updateMany: txInventoryTxUpdateMany },
          writeOff: { updateMany: txWriteOffUpdateMany },
          menuItem: { updateMany: txMenuItemUpdateMany },
          inventoryAuditCount: {
            findMany: txAuditCountFindMany,
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          inventorySku: {
            // First .update inside tx is recalculateStock; second is the archive call.
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              if (data.stockQuantity !== undefined) return txInnerSkuUpdate({ where, data });
              return txSkuUpdate({ where, data });
            }),
          },
        })
    );

    // After the transaction, mergeSku does a final getSku(targetId).
    mockPrisma.inventorySku.findUnique.mockImplementationOnce(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "src") return Promise.resolve(source);
        return Promise.resolve(null);
      }
    );
    mockPrisma.inventorySku.findUnique.mockImplementationOnce(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "tgt") return Promise.resolve(target);
        return Promise.resolve(null);
      }
    );
    // Final getSku(targetId) after tx
    mockPrisma.inventorySku.findUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: "tgt", name: "Coca-Cola", stockQuantity: 42 })
    );

    const result = await mergeSku("src", "tgt", "user-admin");

    expect(txStockBatchUpdateMany).toHaveBeenCalledWith({
      where: { skuId: "src" },
      data: { skuId: "tgt" },
    });
    expect(txMovementUpdateMany).toHaveBeenCalledWith({
      where: { skuId: "src" },
      data: { skuId: "tgt" },
    });
    expect(txInventoryTxUpdateMany).toHaveBeenCalledWith({
      where: { skuId: "src" },
      data: { skuId: "tgt" },
    });
    // Source archived with marker prefix
    expect(txSkuUpdate).toHaveBeenCalledWith({
      where: { id: "src" },
      data: expect.objectContaining({
        isActive: false,
        name: expect.stringContaining("[Объединён → Coca-Cola]"),
      }),
    });
    // recalculateStock writes target's new quantity
    expect(txInnerSkuUpdate).toHaveBeenCalledWith({
      where: { id: "tgt" },
      data: { stockQuantity: 42 },
    });
    expect(result).toMatchObject({
      mergedSourceId: "src",
      targetId: "tgt",
      targetName: "Coca-Cola",
      newStockQuantity: 42,
      performedById: "user-admin",
    });
  });

  it("throws MERGE_SAME when sourceId === targetId", async () => {
    await expect(mergeSku("same", "same", "user1")).rejects.toMatchObject({
      code: "MERGE_SAME",
    });
    // Bails out before touching the DB
    expect(mockPrisma.inventorySku.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("throws SKU_NOT_FOUND when source does not exist", async () => {
    mockPrisma.inventorySku.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "src") return Promise.resolve(null);
        if (where.id === "tgt") return Promise.resolve({ id: "tgt", name: "X", isActive: true });
        return Promise.resolve(null);
      }
    );

    await expect(mergeSku("src", "tgt", "user1")).rejects.toMatchObject({
      code: "SKU_NOT_FOUND",
      message: expect.stringContaining("Исходный"),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("throws SKU_NOT_FOUND when target does not exist", async () => {
    mockPrisma.inventorySku.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "src") return Promise.resolve({ id: "src", name: "X", isActive: true });
        if (where.id === "tgt") return Promise.resolve(null);
        return Promise.resolve(null);
      }
    );

    await expect(mergeSku("src", "tgt", "user1")).rejects.toMatchObject({
      code: "SKU_NOT_FOUND",
      message: expect.stringContaining("Целевой"),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("idempotency: throws SKU_ALREADY_ARCHIVED when source is already inactive", async () => {
    mockPrisma.inventorySku.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "src")
          return Promise.resolve({ id: "src", name: "X", isActive: false });
        if (where.id === "tgt")
          return Promise.resolve({ id: "tgt", name: "Y", isActive: true });
        return Promise.resolve(null);
      }
    );

    await expect(mergeSku("src", "tgt", "user1")).rejects.toBeInstanceOf(
      InventoryError
    );
    await expect(mergeSku("src", "tgt", "user1")).rejects.toMatchObject({
      code: "SKU_ALREADY_ARCHIVED",
    });
    // No mutation ever started
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
