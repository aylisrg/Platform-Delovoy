import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock alerts to prevent real Telegram calls during service tests
vi.mock("../alerts", () => ({
  checkAndSendLowStockAlert: vi.fn().mockResolvedValue(undefined),
  runLowStockAlertSweep: vi.fn().mockResolvedValue({ checked: 0, alerted: 0 }),
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
    },
    stockReceiptItem: {
      create: vi.fn(),
      update: vi.fn(),
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
