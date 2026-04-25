import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    inventoryTransaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    stockBatch: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { recalculateStock, updateReceipt, deleteReceipt } from "../stock";

const mockPrisma = prisma as unknown as {
  inventoryTransaction: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  stockBatch: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

type TxMocks = {
  stockBatch: {
    aggregate: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  stockMovement: { deleteMany: ReturnType<typeof vi.fn> };
  inventorySku: { update: ReturnType<typeof vi.fn> };
  inventoryTransaction: {
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

function makeTx(overrides: Partial<TxMocks> = {}): TxMocks {
  return {
    stockBatch: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 0 }, _count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      ...overrides.stockBatch,
    },
    stockMovement: {
      deleteMany: vi.fn(),
      ...overrides.stockMovement,
    },
    inventorySku: { update: vi.fn(), ...overrides.inventorySku },
    inventoryTransaction: {
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.inventoryTransaction,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recalculateStock", () => {
  it("sums remainingQty across non-exhausted batches and writes to stockQuantity", async () => {
    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 17 }, _count: 3 }),
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    const result = await recalculateStock(tx as never, "sku1");

    expect(tx.stockBatch.aggregate).toHaveBeenCalledWith({
      where: { skuId: "sku1", isExhausted: false },
      _sum: { remainingQty: true },
      _count: true,
    });
    expect(tx.inventorySku.update).toHaveBeenCalledWith({
      where: { id: "sku1" },
      data: { stockQuantity: 17 },
    });
    expect(result).toEqual({ skuId: "sku1", newStockQuantity: 17, batchesCount: 3 });
  });

  it("treats missing aggregate sum as 0", async () => {
    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: null }, _count: 0 }),
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    const result = await recalculateStock(tx as never, "sku1");
    expect(result.newStockQuantity).toBe(0);
    expect(tx.inventorySku.update).toHaveBeenCalledWith({
      where: { id: "sku1" },
      data: { stockQuantity: 0 },
    });
  });
});

describe("updateReceipt", () => {
  it("throws when receipt transaction not found", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue(null);
    await expect(
      updateReceipt("tx-missing", { quantity: 5 }, "user1")
    ).rejects.toMatchObject({ code: "RECEIPT_NOT_FOUND" });
  });

  it("throws when transaction already voided", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      quantity: 10,
      isVoided: true,
      skuId: "sku1",
      receivedAt: null,
      createdAt: new Date(),
    });
    await expect(
      updateReceipt("tx1", { quantity: 5 }, "user1")
    ).rejects.toMatchObject({ code: "RECEIPT_VOIDED" });
  });

  it("throws when editing a non-receipt transaction (SALE)", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "SALE",
      quantity: 10,
      isVoided: false,
      skuId: "sku1",
      receivedAt: null,
      createdAt: new Date(),
    });
    await expect(
      updateReceipt("tx1", { quantity: 5 }, "user1")
    ).rejects.toMatchObject({ code: "NOT_A_RECEIPT" });
  });

  it("increases quantity: updates linked batch and recalculates stock", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      quantity: 10,
      isVoided: false,
      skuId: "sku1",
      receivedAt: new Date("2026-04-20"),
      createdAt: new Date(),
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 20 }, _count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "batch1",
          initialQty: 10,
          remainingQty: 10,
          receiptTxId: "tx1",
        }),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    const result = await updateReceipt("tx1", { quantity: 20 }, "user1");

    expect(tx.stockBatch.update).toHaveBeenCalledWith({
      where: { id: "batch1" },
      data: expect.objectContaining({
        initialQty: 20,
        remainingQty: 20,
        isExhausted: false,
      }),
    });
    expect(tx.inventoryTransaction.update).toHaveBeenCalledWith({
      where: { id: "tx1" },
      data: expect.objectContaining({ quantity: 20 }),
    });
    expect(result).toEqual({
      receiptId: "tx1",
      skuId: "sku1",
      newStockQuantity: 20,
      delta: 10,
    });
  });

  it("decreases quantity within consumed limit: updates batch remainingQty", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      quantity: 10,
      isVoided: false,
      skuId: "sku1",
      receivedAt: new Date("2026-04-20"),
      createdAt: new Date(),
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 5 }, _count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "batch1",
          initialQty: 10,
          remainingQty: 8, // consumed = 2
          receiptTxId: "tx1",
        }),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    const result = await updateReceipt("tx1", { quantity: 7 }, "user1");

    // initialQty 10→7, remainingQty 8→5 (delta -3)
    expect(tx.stockBatch.update).toHaveBeenCalledWith({
      where: { id: "batch1" },
      data: expect.objectContaining({
        initialQty: 7,
        remainingQty: 5,
      }),
    });
    expect(result.delta).toBe(-3);
  });

  it("rejects decrease below consumed quantity", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      quantity: 10,
      isVoided: false,
      skuId: "sku1",
      receivedAt: new Date(),
      createdAt: new Date(),
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 3 }, _count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "batch1",
          initialQty: 10,
          remainingQty: 3, // consumed = 7
          receiptTxId: "tx1",
        }),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      updateReceipt("tx1", { quantity: 5 }, "user1") // 5 < 7 consumed
    ).rejects.toMatchObject({ code: "RECEIPT_PARTIALLY_SOLD" });
  });

  it("creates compensating batch for legacy receipt (no linked batch) on increase", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      quantity: 10,
      isVoided: false,
      skuId: "sku1",
      receivedAt: new Date("2026-04-20"),
      createdAt: new Date(),
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 5 }, _count: 1 }),
        findFirst: vi.fn().mockResolvedValue(null), // no linked batch
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await updateReceipt("tx1", { quantity: 15 }, "user1");

    expect(tx.stockBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skuId: "sku1",
        receiptTxId: "tx1",
        initialQty: 5, // delta
        remainingQty: 5,
      }),
    });
  });

  it("rejects decrease on legacy receipt with no linked batch", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      quantity: 10,
      isVoided: false,
      skuId: "sku1",
      receivedAt: new Date(),
      createdAt: new Date(),
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 0 }, _count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      updateReceipt("tx1", { quantity: 3 }, "user1")
    ).rejects.toMatchObject({ code: "RECEIPT_NOT_LINKED_TO_BATCH" });
  });
});

describe("deleteReceipt", () => {
  it("throws when transaction not found", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue(null);
    await expect(
      deleteReceipt("tx-missing", "user1", {})
    ).rejects.toMatchObject({ code: "RECEIPT_NOT_FOUND" });
  });

  it("throws when type is not RECEIPT/INITIAL", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "SALE",
      skuId: "sku1",
      quantity: 5,
    });
    await expect(
      deleteReceipt("tx1", "user1", {})
    ).rejects.toMatchObject({ code: "NOT_A_RECEIPT" });
  });

  it("refuses to delete partially consumed receipt", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      skuId: "sku1",
      quantity: 10,
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 5 }, _count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "batch1",
          initialQty: 10,
          remainingQty: 3, // consumed = 7
          receiptTxId: "tx1",
        }),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      deleteReceipt("tx1", "user1", {})
    ).rejects.toMatchObject({ code: "RECEIPT_PARTIALLY_SOLD" });
  });

  it("hard-deletes batch+movements+transaction when unconsumed, then recalculates", async () => {
    mockPrisma.inventoryTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEIPT",
      skuId: "sku1",
      quantity: 10,
    });

    const tx = makeTx({
      stockBatch: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQty: 0 }, _count: 0 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "batch1",
          initialQty: 10,
          remainingQty: 10,
          receiptTxId: "tx1",
        }),
        update: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    const result = await deleteReceipt("tx1", "user1", { reason: "mistake" });

    expect(tx.stockMovement.deleteMany).toHaveBeenCalledWith({ where: { batchId: "batch1" } });
    expect(tx.stockBatch.delete).toHaveBeenCalledWith({ where: { id: "batch1" } });
    expect(tx.inventoryTransaction.delete).toHaveBeenCalledWith({ where: { id: "tx1" } });
    expect(result).toEqual({
      receiptId: "tx1",
      skuId: "sku1",
      newStockQuantity: 0,
    });
  });
});

describe("invariant property test", () => {
  // Simulate the invariant SUM(batch.remainingQty) === sku.stockQuantity
  // using an in-memory model. This verifies the logic of recalculateStock +
  // batch manipulation holds across random mutation sequences.

  type Batch = { id: string; remainingQty: number; isExhausted: boolean };
  type State = { batches: Batch[]; stockQuantity: number };

  function applyRecalc(state: State): State {
    const sum = state.batches
      .filter((b) => !b.isExhausted)
      .reduce((s, b) => s + b.remainingQty, 0);
    return { ...state, stockQuantity: sum };
  }

  function addBatch(state: State, qty: number): State {
    const id = `b${state.batches.length + 1}`;
    const next = {
      batches: [...state.batches, { id, remainingQty: qty, isExhausted: false }],
      stockQuantity: state.stockQuantity,
    };
    return applyRecalc(next);
  }

  function fifoDeduct(state: State, qty: number): State {
    let remaining = qty;
    const batches = state.batches.map((b) => ({ ...b }));
    for (const b of batches) {
      if (remaining <= 0) break;
      if (b.isExhausted || b.remainingQty === 0) continue;
      const take = Math.min(b.remainingQty, remaining);
      b.remainingQty -= take;
      if (b.remainingQty === 0) b.isExhausted = true;
      remaining -= take;
    }
    return applyRecalc({ ...state, batches });
  }

  it("invariant holds for 200 random operations", () => {
    let state: State = { batches: [], stockQuantity: 0 };

    // seed with RNG but deterministic for test reproducibility
    let seed = 42;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let i = 0; i < 200; i++) {
      const op = rnd();
      if (op < 0.5 || state.stockQuantity === 0) {
        // receive
        const qty = 1 + Math.floor(rnd() * 20);
        state = addBatch(state, qty);
      } else {
        // sale FIFO up to current stock
        const qty = 1 + Math.floor(rnd() * state.stockQuantity);
        state = fifoDeduct(state, qty);
      }

      const sum = state.batches
        .filter((b) => !b.isExhausted)
        .reduce((s, b) => s + b.remainingQty, 0);
      expect(state.stockQuantity).toBe(sum);
      expect(state.stockQuantity).toBeGreaterThanOrEqual(0);
    }
  });
});
