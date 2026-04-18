import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock alerts and notifications to prevent real Telegram calls during service tests
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
    supplier: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    stockReceipt: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    stockReceiptItem: {
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    stockReceiptCorrection: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    stockBatch: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    stockMovement: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    writeOff: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    inventoryAudit: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    inventoryAuditCount: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    inventorySku: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    menuItem: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getExpiringBatches,
  listWriteOffs,
  createAudit,
  listAudits,
  listMovements,
  getInventoryDashboard,
  createStockReceipt,
  confirmReceipt,
  flagProblem,
  editDraftReceipt,
  listPendingReceipts,
  listReceipts,
  getReceipt,
  getReceiptCorrections,
} from "../service-v2";
import { InventoryError } from "../service";

// Cast for easy mock access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// SUPPLIERS
// ============================================================

describe("listSuppliers", () => {
  it("returns all active suppliers when no filter", async () => {
    const mockSuppliers = [
      { id: "s1", name: "ООО Снабжение", isActive: true },
      { id: "s2", name: "ИП Иванов", isActive: true },
    ];
    db.supplier.findMany.mockResolvedValue(mockSuppliers);

    const result = await listSuppliers();

    expect(db.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } })
    );
    expect(result).toHaveLength(2);
  });

  it("filters by isActive=false", async () => {
    db.supplier.findMany.mockResolvedValue([]);

    await listSuppliers({ isActive: false });

    expect(db.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false }),
      })
    );
  });

  it("applies search filter across name and contactName", async () => {
    db.supplier.findMany.mockResolvedValue([]);

    await listSuppliers({ search: "Иванов" });

    expect(db.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { contains: "Иванов", mode: "insensitive" } }),
          ]),
        }),
      })
    );
  });
});

describe("createSupplier", () => {
  it("creates a supplier with all fields", async () => {
    const input = {
      name: "ООО Напитки",
      contactName: "Пётр",
      phone: "+79001234567",
      email: "info@drinks.ru",
    };
    const created = { id: "sup1", ...input, isActive: true, createdAt: new Date(), updatedAt: new Date() };
    db.supplier.create.mockResolvedValue(created);

    const result = await createSupplier(input);

    expect(db.supplier.create).toHaveBeenCalledWith({ data: input });
    expect(result.id).toBe("sup1");
  });
});

describe("updateSupplier", () => {
  it("throws NOT_FOUND when supplier does not exist", async () => {
    db.supplier.findUnique.mockResolvedValue(null);

    await expect(updateSupplier("missing", { name: "X" })).rejects.toMatchObject({
      code: "SUPPLIER_NOT_FOUND",
    });
  });

  it("updates supplier fields", async () => {
    db.supplier.findUnique.mockResolvedValue({ id: "s1", name: "Old" });
    db.supplier.update.mockResolvedValue({ id: "s1", name: "New" });

    const result = await updateSupplier("s1", { name: "New" });

    expect(db.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1" }, data: { name: "New" } })
    );
    expect(result.name).toBe("New");
  });
});

describe("deleteSupplier", () => {
  it("soft-deletes by setting isActive=false", async () => {
    db.supplier.findUnique.mockResolvedValue({ id: "s1", isActive: true });
    db.supplier.update.mockResolvedValue({ id: "s1", isActive: false });

    await deleteSupplier("s1");

    expect(db.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    );
  });

  it("throws NOT_FOUND when supplier missing", async () => {
    db.supplier.findUnique.mockResolvedValue(null);

    await expect(deleteSupplier("ghost")).rejects.toMatchObject({
      code: "SUPPLIER_NOT_FOUND",
    });
  });
});

// ============================================================
// WRITE-OFFS
// ============================================================

describe("listWriteOffs", () => {
  it("returns paginated write-offs", async () => {
    const mockRows = [{ id: "wo1", quantity: 3 }];
    db.writeOff.findMany.mockResolvedValue(mockRows);
    db.writeOff.count.mockResolvedValue(1);

    const result = await listWriteOffs({ page: 1, perPage: 10 });

    expect(result.writeOffs).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("filters by reason", async () => {
    db.writeOff.findMany.mockResolvedValue([]);
    db.writeOff.count.mockResolvedValue(0);

    await listWriteOffs({ reason: "EXPIRED" });

    expect(db.writeOff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reason: "EXPIRED" }),
      })
    );
  });
});

// ============================================================
// EXPIRATION TRACKING
// ============================================================

describe("getExpiringBatches", () => {
  it("returns batches expiring within N days", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const mockBatches = [
      {
        id: "b1",
        skuId: "sku1",
        remainingQty: 5,
        expiresAt,
        sku: { id: "sku1", name: "Кола", unit: "шт" },
      },
    ];
    db.stockBatch.findMany.mockResolvedValue(mockBatches);

    const result = await getExpiringBatches(7);

    expect(result).toHaveLength(1);
    expect(result[0].skuName).toBe("Кола");
    expect(result[0].daysUntilExpiry).toBeGreaterThan(0);
    expect(result[0].daysUntilExpiry).toBeLessThanOrEqual(4);
  });

  it("marks already-expired batches with negative daysUntilExpiry", async () => {
    const expiredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const mockBatches = [
      {
        id: "b2",
        skuId: "sku2",
        remainingQty: 2,
        expiresAt: expiredAt,
        sku: { id: "sku2", name: "Чипсы", unit: "шт" },
      },
    ];
    db.stockBatch.findMany.mockResolvedValue(mockBatches);

    const result = await getExpiringBatches(0);

    expect(result[0].daysUntilExpiry).toBeLessThanOrEqual(0);
  });
});

// ============================================================
// INVENTORY AUDIT
// ============================================================

describe("createAudit", () => {
  it("creates a new audit when none in progress", async () => {
    db.inventoryAudit.findFirst.mockResolvedValue(null);
    db.inventoryAudit.create.mockResolvedValue({
      id: "audit1",
      status: "IN_PROGRESS",
      startedById: "user1",
    });

    const result = await createAudit({ notes: "Тест" }, "user1");

    expect(db.inventoryAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ startedById: "user1" }),
      })
    );
    expect(result.status).toBe("IN_PROGRESS");
  });

  it("throws when another audit is in progress", async () => {
    db.inventoryAudit.findFirst.mockResolvedValue({ id: "existing", status: "IN_PROGRESS" });

    await expect(createAudit({}, "user1")).rejects.toMatchObject({
      code: "AUDIT_IN_PROGRESS",
    });
  });
});

describe("listAudits", () => {
  it("returns all audits sorted by startedAt desc", async () => {
    const mockAudits = [
      { id: "a1", status: "COMPLETED", _count: { counts: 10 } },
      { id: "a2", status: "IN_PROGRESS", _count: { counts: 0 } },
    ];
    db.inventoryAudit.findMany.mockResolvedValue(mockAudits);

    const result = await listAudits();

    expect(db.inventoryAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" } })
    );
    expect(result).toHaveLength(2);
  });
});

// ============================================================
// STOCK MOVEMENTS
// ============================================================

describe("listMovements", () => {
  it("returns paginated movements", async () => {
    const mockMovements = [{ id: "m1", type: "RECEIPT", delta: 10 }];
    db.stockMovement.findMany.mockResolvedValue(mockMovements);
    db.stockMovement.count.mockResolvedValue(1);

    const result = await listMovements({ page: 1, perPage: 20 });

    expect(result.movements).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("filters by skuId and type", async () => {
    db.stockMovement.findMany.mockResolvedValue([]);
    db.stockMovement.count.mockResolvedValue(0);

    await listMovements({ skuId: "sku1", type: "SALE" });

    expect(db.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ skuId: "sku1", type: "SALE" }),
      })
    );
  });
});

// ============================================================
// DASHBOARD
// ============================================================

describe("getInventoryDashboard", () => {
  it("computes stock values and top sellers", async () => {
    const mockSkus = [
      {
        id: "sku1",
        name: "Кола",
        stockQuantity: 10,
        lowStockThreshold: 5,
        price: 100,
        batches: [{ costPerUnit: 60, remainingQty: 10 }],
      },
    ];
    const mockMovements = [
      {
        skuId: "sku1",
        delta: -3,
        sku: { id: "sku1", name: "Кола", price: 100 },
      },
    ];
    db.inventorySku.findMany.mockResolvedValue(mockSkus);
    db.stockMovement.findMany.mockResolvedValue(mockMovements);
    db.writeOff.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });

    const result = await getInventoryDashboard();

    expect(result.totalPotentialRevenue).toBe("1000.00");
    expect(result.totalStockValueAtCost).toBe("600.00");
    expect(result.stockStatus.total).toBe(1);
    expect(result.topSellers30Days).toHaveLength(1);
    expect(result.writeOffsQty30Days).toBe(2);
  });

  it("handles empty inventory gracefully", async () => {
    db.inventorySku.findMany.mockResolvedValue([]);
    db.stockMovement.findMany.mockResolvedValue([]);
    db.writeOff.aggregate.mockResolvedValue({ _sum: { quantity: null } });

    const result = await getInventoryDashboard();

    expect(result.stockStatus.total).toBe(0);
    expect(result.topSellers30Days).toHaveLength(0);
    expect(result.writeOffsQty30Days).toBe(0);
    expect(result.grossMarginPercent).toBe("0.0");
  });
});

// ============================================================
// InventoryError
// ============================================================

describe("InventoryError", () => {
  it("has code and message properties", () => {
    const err = new InventoryError("TEST_CODE", "Test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("Test message");
    expect(err instanceof Error).toBe(true);
  });
});

// ============================================================
// createStockReceipt (DRAFT mode)
// ============================================================

describe("createStockReceipt", () => {
  it("creates receipt in DRAFT status without touching stock", async () => {
    const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        inventorySku: { findUnique: vi.fn().mockResolvedValue({ id: "sku1", isActive: true }) },
        stockReceipt: { create: vi.fn().mockResolvedValue({ id: "r1" }) },
        stockReceiptItem: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    db.$transaction.mockImplementation(txFn);
    db.user.findUnique.mockResolvedValue({ name: "Иван" });

    const result = await createStockReceipt(
      {
        receivedAt: "2026-04-10",
        moduleSlug: "cafe",
        items: [{ skuId: "sku1", quantity: 5 }],
      },
      "user1"
    );

    expect(result.status).toBe("DRAFT");
    expect(result.receiptId).toBe("r1");
    // Stock movements should NOT be called during DRAFT creation
    expect(db.stockMovement.create).not.toHaveBeenCalled();
  });

  it("throws SKU_NOT_FOUND for inactive SKU", async () => {
    const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        inventorySku: { findUnique: vi.fn().mockResolvedValue(null) },
        stockReceipt: { create: vi.fn() },
        stockReceiptItem: { create: vi.fn() },
      };
      return fn(tx);
    });
    db.$transaction.mockImplementation(txFn);

    await expect(
      createStockReceipt(
        { receivedAt: "2026-04-10", items: [{ skuId: "ghost", quantity: 1 }] },
        "user1"
      )
    ).rejects.toMatchObject({ code: "SKU_NOT_FOUND" });
  });
});

// ============================================================
// confirmReceipt
// ============================================================

describe("confirmReceipt", () => {
  it("confirms DRAFT receipt and returns CONFIRMED status", async () => {
    const mockReceipt = {
      id: "r1",
      status: "DRAFT",
      items: [{ id: "ri1", skuId: "sku1", quantity: 10, costPerUnit: null, expiresAt: null }],
      invoiceNumber: "INV-001",
      receivedAt: new Date("2026-04-10"),
      moduleSlug: "cafe",
      performedById: "manager1",
    };

    const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stockReceipt: {
          findUnique: vi.fn().mockResolvedValue(mockReceipt),
          update: vi.fn().mockResolvedValue({}),
        },
        stockBatch: { create: vi.fn().mockResolvedValue({ id: "b1" }) },
        stockReceiptItem: { update: vi.fn().mockResolvedValue({}) },
        inventorySku: { update: vi.fn().mockResolvedValue({ stockQuantity: 10 }) },
        stockMovement: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    db.$transaction.mockImplementation(txFn);
    db.user.findUnique.mockResolvedValue({ name: "Сергей" });

    const result = await confirmReceipt("r1", "admin1");

    expect(result.status).toBe("CONFIRMED");
    expect(result.receiptId).toBe("r1");
  });

  it("throws RECEIPT_NOT_FOUND when receipt missing", async () => {
    const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stockReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      return fn(tx);
    });
    db.$transaction.mockImplementation(txFn);

    await expect(confirmReceipt("ghost", "admin1")).rejects.toMatchObject({
      code: "RECEIPT_NOT_FOUND",
    });
  });

  it("throws INVALID_STATUS when receipt is already CONFIRMED", async () => {
    const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stockReceipt: {
          findUnique: vi.fn().mockResolvedValue({
            id: "r1",
            status: "CONFIRMED",
            items: [],
          }),
        },
      };
      return fn(tx);
    });
    db.$transaction.mockImplementation(txFn);

    await expect(confirmReceipt("r1", "admin1")).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

// ============================================================
// flagProblem
// ============================================================

describe("flagProblem", () => {
  it("sets PROBLEM status on a DRAFT receipt", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({
      id: "r1",
      status: "DRAFT",
      items: [],
      moduleSlug: "cafe",
      receivedAt: new Date(),
    });
    db.stockReceipt.update.mockResolvedValue({});
    db.user.findUnique.mockResolvedValue({ name: "Иван" });

    const result = await flagProblem("r1", "Не совпадает количество", "manager1");

    expect(result.status).toBe("PROBLEM");
    expect(db.stockReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PROBLEM",
          problemNote: "Не совпадает количество",
          problemReportedById: "manager1",
        }),
      })
    );
  });

  it("throws RECEIPT_NOT_FOUND when receipt missing", async () => {
    db.stockReceipt.findUnique.mockResolvedValue(null);

    await expect(flagProblem("ghost", "Проблема", "manager1")).rejects.toMatchObject({
      code: "RECEIPT_NOT_FOUND",
    });
  });

  it("throws INVALID_STATUS for CORRECTED receipt", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({
      id: "r1",
      status: "CORRECTED",
      items: [],
    });

    await expect(flagProblem("r1", "Проблема", "manager1")).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

// ============================================================
// editDraftReceipt
// ============================================================

describe("editDraftReceipt", () => {
  it("updates header fields for a DRAFT receipt", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({
      id: "r1",
      status: "DRAFT",
      items: [],
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stockReceipt: { update: vi.fn().mockResolvedValue({}) },
        stockReceiptItem: {
          deleteMany: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({}),
        },
        inventorySku: { findUnique: vi.fn().mockResolvedValue({ id: "sku1", isActive: true }) },
      };
      return fn(tx);
    });
    db.$transaction.mockImplementation(txFn);

    const result = await editDraftReceipt(
      "r1",
      { invoiceNumber: "INV-999", items: [{ skuId: "sku1", quantity: 3 }] },
      "admin1"
    );

    expect(result.receiptId).toBe("r1");
    expect(result.status).toBe("DRAFT");
  });

  it("throws RECEIPT_NOT_FOUND when receipt missing", async () => {
    db.stockReceipt.findUnique.mockResolvedValue(null);

    await expect(editDraftReceipt("ghost", {}, "admin1")).rejects.toMatchObject({
      code: "RECEIPT_NOT_FOUND",
    });
  });

  it("throws INVALID_STATUS for CONFIRMED receipt", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({
      id: "r1",
      status: "CONFIRMED",
      items: [],
    });

    await expect(editDraftReceipt("r1", { invoiceNumber: "X" }, "admin1")).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

// ============================================================
// listPendingReceipts
// ============================================================

describe("listPendingReceipts", () => {
  it("returns DRAFT and PROBLEM receipts with daysPending", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    db.stockReceipt.findMany.mockResolvedValue([
      {
        id: "r1",
        status: "DRAFT",
        moduleSlug: "cafe",
        performedById: "m1",
        receivedAt: new Date("2026-04-10"),
        createdAt: twoDaysAgo,
        items: [{ costPerUnit: 50, quantity: 5 }],
        supplier: null,
      },
      {
        id: "r2",
        status: "PROBLEM",
        moduleSlug: "bbq",
        performedById: "m2",
        receivedAt: new Date("2026-04-11"),
        createdAt: twoDaysAgo,
        items: [],
        supplier: { id: "s1", name: "Поставщик" },
      },
    ]);

    const result = await listPendingReceipts({});

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("r1");
    expect(result[0].daysPending).toBeGreaterThanOrEqual(1);
    expect(result[0].totalAmount).toBe("250.00");
    expect(result[1].status).toBe("PROBLEM");
  });

  it("filters by moduleSlug", async () => {
    db.stockReceipt.findMany.mockResolvedValue([]);

    await listPendingReceipts({ moduleSlug: "cafe" });

    expect(db.stockReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ moduleSlug: "cafe" }),
      })
    );
  });

  it("filters by modulesSlugs array", async () => {
    db.stockReceipt.findMany.mockResolvedValue([]);

    await listPendingReceipts({ modulesSlugs: ["cafe", "bbq"] });

    expect(db.stockReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          moduleSlug: { in: ["cafe", "bbq"] },
        }),
      })
    );
  });
});

// ============================================================
// listReceipts
// ============================================================

describe("listReceipts", () => {
  it("returns paginated receipts with total", async () => {
    db.stockReceipt.findMany.mockResolvedValue([{ id: "r1", status: "CONFIRMED" }]);
    db.stockReceipt.count.mockResolvedValue(1);

    const result = await listReceipts({ page: 1, perPage: 10 });

    expect(result.receipts).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("filters by status", async () => {
    db.stockReceipt.findMany.mockResolvedValue([]);
    db.stockReceipt.count.mockResolvedValue(0);

    await listReceipts({ status: "DRAFT" });

    expect(db.stockReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "DRAFT" }),
      })
    );
  });

  it("filters by performedById", async () => {
    db.stockReceipt.findMany.mockResolvedValue([]);
    db.stockReceipt.count.mockResolvedValue(0);

    await listReceipts({ performedById: "manager1" });

    expect(db.stockReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ performedById: "manager1" }),
      })
    );
  });
});

// ============================================================
// getReceipt
// ============================================================

describe("getReceipt", () => {
  it("returns receipt with items and corrections", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({
      id: "r1",
      status: "CONFIRMED",
      items: [{ id: "ri1", skuId: "sku1", quantity: 10 }],
      corrections: [],
    });

    const result = await getReceipt("r1");
    expect(result.id).toBe("r1");
  });

  it("throws RECEIPT_NOT_FOUND when missing", async () => {
    db.stockReceipt.findUnique.mockResolvedValue(null);

    await expect(getReceipt("ghost")).rejects.toMatchObject({
      code: "RECEIPT_NOT_FOUND",
    });
  });
});

// ============================================================
// getReceiptCorrections
// ============================================================

describe("getReceiptCorrections", () => {
  it("returns corrections with corrector names", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({ id: "r1" });
    db.stockReceiptCorrection.findMany.mockResolvedValue([
      {
        id: "c1",
        receiptId: "r1",
        correctedById: "admin1",
        reason: "Ошиблись в количестве",
        itemsBefore: [{ skuId: "sku1", quantity: 10 }],
        itemsAfter: [{ skuId: "sku1", quantity: 8 }],
        createdAt: new Date("2026-04-15T10:00:00Z"),
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "admin1", name: "Сергей" }]);

    const result = await getReceiptCorrections("r1");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
    expect(result[0].correctedByName).toBe("Сергей");
    expect(result[0].reason).toBe("Ошиблись в количестве");
  });

  it("throws RECEIPT_NOT_FOUND when receipt missing", async () => {
    db.stockReceipt.findUnique.mockResolvedValue(null);

    await expect(getReceiptCorrections("ghost")).rejects.toMatchObject({
      code: "RECEIPT_NOT_FOUND",
    });
  });

  it("returns empty array when no corrections", async () => {
    db.stockReceipt.findUnique.mockResolvedValue({ id: "r1" });
    db.stockReceiptCorrection.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);

    const result = await getReceiptCorrections("r1");
    expect(result).toHaveLength(0);
  });
});
