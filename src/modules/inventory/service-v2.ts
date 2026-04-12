import { prisma } from "@/lib/db";
import type { Prisma, WriteOffReason } from "@prisma/client";
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  CreateStockReceiptInput,
  CreateWriteOffInput,
  CreateAuditInput,
  AuditCountInput,
  MovementFilter,
  FifoDeductResult,
  ExpiringBatchRow,
} from "./types";
import { InventoryError } from "./service";
import { checkAndSendLowStockAlert } from "./alerts";

// ============================================================
// SUPPLIERS
// ============================================================

export async function listSuppliers(filter?: {
  search?: string;
  isActive?: boolean;
}) {
  return prisma.supplier.findMany({
    where: {
      ...(filter?.isActive !== undefined && { isActive: filter.isActive }),
      ...(filter?.search && {
        OR: [
          { name: { contains: filter.search, mode: "insensitive" } },
          { contactName: { contains: filter.search, mode: "insensitive" } },
        ],
      }),
    },
    orderBy: { name: "asc" },
  });
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      receipts: {
        orderBy: { receivedAt: "desc" },
        take: 50,
        include: {
          items: {
            include: {
              sku: { select: { id: true, name: true, unit: true } },
            },
          },
        },
      },
    },
  });
  if (!supplier) throw new InventoryError("SUPPLIER_NOT_FOUND", "Поставщик не найден");
  return supplier;
}

export async function createSupplier(input: CreateSupplierInput) {
  return prisma.supplier.create({ data: input });
}

export async function updateSupplier(id: string, input: UpdateSupplierInput) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new InventoryError("SUPPLIER_NOT_FOUND", "Поставщик не найден");
  return prisma.supplier.update({ where: { id }, data: input });
}

export async function deleteSupplier(id: string) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new InventoryError("SUPPLIER_NOT_FOUND", "Поставщик не найден");

  // Soft-delete only
  return prisma.supplier.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, isActive: true },
  });
}

// ============================================================
// STOCK RECEIPTS
// ============================================================

export async function createStockReceipt(
  input: CreateStockReceiptInput,
  performedById: string
) {
  const receivedAt = new Date(input.receivedAt);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create receipt document
    const receipt = await tx.stockReceipt.create({
      data: {
        supplierId: input.supplierId ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        receivedAt,
        notes: input.notes ?? null,
        performedById,
      },
    });

    const batchIds: string[] = [];

    for (const item of input.items) {
      // Validate SKU exists and is active
      const sku = await tx.inventorySku.findUnique({
        where: { id: item.skuId },
        select: { id: true, isActive: true, stockQuantity: true },
      });
      if (!sku || !sku.isActive) {
        throw new InventoryError("SKU_NOT_FOUND", `Товар не найден: ${item.skuId}`);
      }

      // 2. Create receipt item
      const receiptItem = await tx.stockReceiptItem.create({
        data: {
          receiptId: receipt.id,
          skuId: item.skuId,
          quantity: item.quantity,
          costPerUnit: item.costPerUnit ?? null,
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
        },
      });

      // 3. Create stock batch
      const batch = await tx.stockBatch.create({
        data: {
          skuId: item.skuId,
          receiptItemId: receiptItem.id,
          initialQty: item.quantity,
          remainingQty: item.quantity,
          costPerUnit: item.costPerUnit ?? null,
          receiptDate: receivedAt,
          expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
        },
      });
      batchIds.push(batch.id);

      // 4. Update receipt item with batch reference
      await tx.stockReceiptItem.update({
        where: { id: receiptItem.id },
        data: { batchId: batch.id },
      });

      // 5. Update aggregate stock quantity
      const updatedSku = await tx.inventorySku.update({
        where: { id: item.skuId },
        data: { stockQuantity: { increment: item.quantity } },
        select: { stockQuantity: true },
      });

      // 6. Record stock movement
      await tx.stockMovement.create({
        data: {
          skuId: item.skuId,
          batchId: batch.id,
          type: "RECEIPT",
          delta: item.quantity,
          balanceAfter: updatedSku.stockQuantity,
          referenceType: "RECEIPT",
          referenceId: receipt.id,
          performedById,
          note: `Приход от поставщика — накладная ${input.invoiceNumber ?? receipt.id}`,
        },
      });
    }

    return { receiptId: receipt.id, batchIds };
  });

  // 7. Post-transaction: trigger menu auto-enable for linked items
  setImmediate(async () => {
    for (const item of input.items) {
      await autoEnableMenuItems(item.skuId);
    }
  });

  return result;
}

export async function listReceipts(filter: {
  supplierId?: string;
  skuId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;

  const where: Prisma.StockReceiptWhereInput = {
    ...(filter.supplierId && { supplierId: filter.supplierId }),
    ...(filter.skuId && { items: { some: { skuId: filter.skuId } } }),
    ...((filter.dateFrom || filter.dateTo) && {
      receivedAt: {
        ...(filter.dateFrom && { gte: new Date(filter.dateFrom) }),
        ...(filter.dateTo && { lte: new Date(`${filter.dateTo}T23:59:59.999Z`) }),
      },
    }),
  };

  const [receipts, total] = await Promise.all([
    prisma.stockReceipt.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        items: {
          include: { sku: { select: { id: true, name: true, unit: true } } },
        },
      },
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.stockReceipt.count({ where }),
  ]);

  return { receipts, total, page, perPage };
}

export async function getReceipt(id: string) {
  const receipt = await prisma.stockReceipt.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: { sku: { select: { id: true, name: true, unit: true } } },
      },
    },
  });
  if (!receipt) throw new InventoryError("RECEIPT_NOT_FOUND", "Приход не найден");
  return receipt;
}

// ============================================================
// FIFO DEDUCTION ENGINE
// ============================================================

/**
 * Deducts stock from the oldest batches first (FIFO by expiresAt, then receiptDate).
 * Uses pessimistic locking via raw query to prevent race conditions.
 * Must be called inside a Prisma transaction.
 */
export async function deductStockFifo(
  tx: Prisma.TransactionClient,
  skuId: string,
  quantity: number,
  referenceType: "BOOKING" | "ORDER" | "MANUAL",
  referenceId: string | null,
  performedById: string,
  note?: string
): Promise<FifoDeductResult> {
  // Lock rows for update to prevent concurrent deductions
  const batches = await tx.$queryRaw<Array<{
    id: string;
    remainingQty: number;
  }>>`
    SELECT id, "remainingQty"
    FROM "StockBatch"
    WHERE "skuId" = ${skuId}
      AND "isExhausted" = false
      AND "remainingQty" > 0
    ORDER BY "expiresAt" ASC NULLS LAST, "receiptDate" ASC
    FOR UPDATE
  `;

  const totalAvailable = batches.reduce((sum, b) => sum + b.remainingQty, 0);
  if (totalAvailable < quantity) {
    const sku = await tx.inventorySku.findUnique({
      where: { id: skuId },
      select: { name: true },
    });
    throw new InventoryError(
      "INVENTORY_INSUFFICIENT",
      `Недостаточно товара "${sku?.name ?? skuId}": доступно ${totalAvailable}, запрошено ${quantity}`
    );
  }

  const movementIds: string[] = [];
  let remaining = quantity;
  let batchesAffected = 0;

  for (const batch of batches) {
    if (remaining <= 0) break;

    const take = Math.min(batch.remainingQty, remaining);
    const newRemainingQty = batch.remainingQty - take;

    await tx.stockBatch.update({
      where: { id: batch.id },
      data: {
        remainingQty: newRemainingQty,
        isExhausted: newRemainingQty === 0,
      },
    });

    remaining -= take;
    batchesAffected++;
  }

  // Update aggregate once
  const updatedSku = await tx.inventorySku.update({
    where: { id: skuId },
    data: { stockQuantity: { decrement: quantity } },
    select: { stockQuantity: true },
  });

  // Record one movement per batch, each with a correct running balance
  const recordedMovementIds: string[] = [];
  remaining = quantity;
  let runningBalance = updatedSku.stockQuantity + quantity; // start from pre-deduction balance

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingQty, remaining);
    remaining -= take;
    runningBalance -= take; // track balance after each batch deduction

    const movement = await tx.stockMovement.create({
      data: {
        skuId,
        batchId: batch.id,
        type: "SALE",
        delta: -take,
        balanceAfter: runningBalance,
        referenceType,
        referenceId,
        performedById,
        note: note ?? null,
      },
    });
    recordedMovementIds.push(movement.id);
  }

  return {
    movementIds: recordedMovementIds,
    newStockQuantity: updatedSku.stockQuantity,
    batchesAffected,
  };
}

// ============================================================
// WRITE-OFFS
// ============================================================

export async function createWriteOff(
  input: CreateWriteOffInput,
  performedById: string
) {
  const result = await prisma.$transaction(async (tx) => {
    const sku = await tx.inventorySku.findUnique({
      where: { id: input.skuId },
      select: { id: true, name: true, isActive: true, stockQuantity: true },
    });
    if (!sku) throw new InventoryError("SKU_NOT_FOUND", "Товар не найден");

    if (input.batchId) {
      // Specific batch write-off
      const batch = await tx.stockBatch.findUnique({
        where: { id: input.batchId },
        select: { id: true, skuId: true, remainingQty: true },
      });
      if (!batch || batch.skuId !== input.skuId) {
        throw new InventoryError("BATCH_NOT_FOUND", "Партия не найдена");
      }
      if (batch.remainingQty < input.quantity) {
        throw new InventoryError(
          "INVENTORY_INSUFFICIENT",
          `Недостаточно в партии: доступно ${batch.remainingQty}`
        );
      }

      const newRemainingQty = batch.remainingQty - input.quantity;
      await tx.stockBatch.update({
        where: { id: input.batchId },
        data: {
          remainingQty: newRemainingQty,
          isExhausted: newRemainingQty === 0,
        },
      });
    } else {
      // FIFO write-off across batches
      const batches = await tx.$queryRaw<Array<{ id: string; remainingQty: number }>>`
        SELECT id, "remainingQty"
        FROM "StockBatch"
        WHERE "skuId" = ${input.skuId}
          AND "isExhausted" = false
          AND "remainingQty" > 0
        ORDER BY "expiresAt" ASC NULLS LAST, "receiptDate" ASC
        FOR UPDATE
      `;

      const totalAvailable = batches.reduce((sum, b) => sum + b.remainingQty, 0);
      if (totalAvailable < input.quantity) {
        throw new InventoryError(
          "INVENTORY_INSUFFICIENT",
          `Недостаточно товара для списания: доступно ${totalAvailable}`
        );
      }

      let remaining = input.quantity;
      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.remainingQty, remaining);
        const newQty = batch.remainingQty - take;
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { remainingQty: newQty, isExhausted: newQty === 0 },
        });
        remaining -= take;
      }
    }

    // Create write-off record
    const writeOff = await tx.writeOff.create({
      data: {
        skuId: input.skuId,
        batchId: input.batchId ?? null,
        quantity: input.quantity,
        reason: input.reason,
        note: input.note ?? null,
        performedById,
      },
    });

    // Update aggregate
    const updatedSku = await tx.inventorySku.update({
      where: { id: input.skuId },
      data: { stockQuantity: { decrement: input.quantity } },
      select: { stockQuantity: true },
    });

    // Record movement
    await tx.stockMovement.create({
      data: {
        skuId: input.skuId,
        batchId: input.batchId ?? null,
        type: "WRITE_OFF",
        delta: -input.quantity,
        balanceAfter: updatedSku.stockQuantity,
        referenceType: "WRITE_OFF",
        referenceId: writeOff.id,
        performedById,
        note: `Списание: ${WRITE_OFF_REASON_LABELS[input.reason]}${input.note ? ` — ${input.note}` : ""}`,
      },
    });

    return { writeOffId: writeOff.id, newStockQuantity: updatedSku.stockQuantity };
  });

  // Post-transaction: auto-disable menu items if stock hits 0, send low-stock alert
  setImmediate(async () => {
    await autoDisableMenuItems(input.skuId);
    await checkAndSendLowStockAlert(input.skuId);
  });

  return result;
}

export async function createBatchWriteOff(
  items: CreateWriteOffInput[],
  performedById: string
) {
  // All items in one atomic transaction — if any item fails, nothing is committed
  return prisma.$transaction(async (tx) => {
    const results = [];

    for (const item of items) {
      const sku = await tx.inventorySku.findUnique({
        where: { id: item.skuId },
        select: { id: true, name: true, isActive: true },
      });
      if (!sku) throw new InventoryError("SKU_NOT_FOUND", `Товар не найден: ${item.skuId}`);

      if (item.batchId) {
        const batch = await tx.stockBatch.findUnique({
          where: { id: item.batchId },
          select: { id: true, skuId: true, remainingQty: true },
        });
        if (!batch || batch.skuId !== item.skuId) {
          throw new InventoryError("BATCH_NOT_FOUND", "Партия не найдена");
        }
        if (batch.remainingQty < item.quantity) {
          throw new InventoryError(
            "INVENTORY_INSUFFICIENT",
            `Недостаточно в партии: доступно ${batch.remainingQty}`
          );
        }
        const newQty = batch.remainingQty - item.quantity;
        await tx.stockBatch.update({
          where: { id: item.batchId },
          data: { remainingQty: newQty, isExhausted: newQty === 0 },
        });
      } else {
        const batches = await tx.$queryRaw<Array<{ id: string; remainingQty: number }>>`
          SELECT id, "remainingQty"
          FROM "StockBatch"
          WHERE "skuId" = ${item.skuId}
            AND "isExhausted" = false
            AND "remainingQty" > 0
          ORDER BY "expiresAt" ASC NULLS LAST, "receiptDate" ASC
          FOR UPDATE
        `;
        const totalAvailable = batches.reduce((sum, b) => sum + b.remainingQty, 0);
        if (totalAvailable < item.quantity) {
          throw new InventoryError(
            "INVENTORY_INSUFFICIENT",
            `Недостаточно товара для списания "${sku.name}": доступно ${totalAvailable}`
          );
        }
        let remaining = item.quantity;
        for (const batch of batches) {
          if (remaining <= 0) break;
          const take = Math.min(batch.remainingQty, remaining);
          const newQty = batch.remainingQty - take;
          await tx.stockBatch.update({
            where: { id: batch.id },
            data: { remainingQty: newQty, isExhausted: newQty === 0 },
          });
          remaining -= take;
        }
      }

      const writeOff = await tx.writeOff.create({
        data: {
          skuId: item.skuId,
          batchId: item.batchId ?? null,
          quantity: item.quantity,
          reason: item.reason,
          note: item.note ?? null,
          performedById,
        },
      });

      const updatedSku = await tx.inventorySku.update({
        where: { id: item.skuId },
        data: { stockQuantity: { decrement: item.quantity } },
        select: { stockQuantity: true },
      });

      await tx.stockMovement.create({
        data: {
          skuId: item.skuId,
          batchId: item.batchId ?? null,
          type: "WRITE_OFF",
          delta: -item.quantity,
          balanceAfter: updatedSku.stockQuantity,
          referenceType: "WRITE_OFF",
          referenceId: writeOff.id,
          performedById,
          note: `Списание (пакетное): ${WRITE_OFF_REASON_LABELS[item.reason]}`,
        },
      });

      results.push({ writeOffId: writeOff.id, newStockQuantity: updatedSku.stockQuantity });
    }

    return results;
  });
}

export async function writeOffExpiredBatches(performedById: string) {
  const now = new Date();
  const expiredBatches = await prisma.stockBatch.findMany({
    where: {
      expiresAt: { lt: now },
      isExhausted: false,
      remainingQty: { gt: 0 },
    },
    include: { sku: { select: { id: true, name: true } } },
  });

  const results = [];
  for (const batch of expiredBatches) {
    const result = await createWriteOff(
      {
        skuId: batch.skuId,
        quantity: batch.remainingQty,
        reason: "EXPIRED" as WriteOffReason,
        batchId: batch.id,
        note: `Срок годности истёк ${batch.expiresAt?.toLocaleDateString("ru-RU")}`,
      },
      performedById
    );
    results.push({ batchId: batch.id, skuName: batch.sku.name, ...result });
  }

  return results;
}

export async function listWriteOffs(filter: {
  skuId?: string;
  reason?: WriteOffReason;
  performedById?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;

  const where: Prisma.WriteOffWhereInput = {
    ...(filter.skuId && { skuId: filter.skuId }),
    ...(filter.reason && { reason: filter.reason }),
    ...(filter.performedById && { performedById: filter.performedById }),
    ...((filter.dateFrom || filter.dateTo) && {
      createdAt: {
        ...(filter.dateFrom && { gte: new Date(filter.dateFrom) }),
        ...(filter.dateTo && { lte: new Date(`${filter.dateTo}T23:59:59.999Z`) }),
      },
    }),
  };

  const [writeOffs, total] = await Promise.all([
    prisma.writeOff.findMany({
      where,
      include: { sku: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.writeOff.count({ where }),
  ]);

  return { writeOffs, total, page, perPage };
}

// ============================================================
// EXPIRATION TRACKING
// ============================================================

export async function getExpiringBatches(days: number = 7): Promise<ExpiringBatchRow[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const batches = await prisma.stockBatch.findMany({
    where: {
      expiresAt: { not: null, lte: cutoff },
      isExhausted: false,
      remainingQty: { gt: 0 },
    },
    include: {
      sku: { select: { id: true, name: true, unit: true } },
    },
    orderBy: { expiresAt: "asc" },
  });

  return batches.map((b) => {
    const expiresAt = b.expiresAt!;
    const msUntilExpiry = expiresAt.getTime() - now.getTime();
    const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));
    return {
      batchId: b.id,
      skuId: b.skuId,
      skuName: b.sku.name,
      skuUnit: b.sku.unit,
      remainingQty: b.remainingQty,
      expiresAt: expiresAt.toISOString(),
      daysUntilExpiry,
    };
  });
}

// ============================================================
// INVENTORY AUDIT
// ============================================================

export async function createAudit(input: CreateAuditInput, startedById: string) {
  // Check no in-progress audit exists
  const existing = await prisma.inventoryAudit.findFirst({
    where: { status: "IN_PROGRESS" },
  });
  if (existing) {
    throw new InventoryError(
      "AUDIT_IN_PROGRESS",
      "Уже есть незавершённая инвентаризация"
    );
  }

  return prisma.inventoryAudit.create({
    data: {
      notes: input.notes ?? null,
      startedById,
    },
  });
}

export async function getAudit(id: string) {
  const audit = await prisma.inventoryAudit.findUnique({
    where: { id },
    include: {
      counts: {
        include: { sku: { select: { id: true, name: true, unit: true } } },
      },
    },
  });
  if (!audit) throw new InventoryError("AUDIT_NOT_FOUND", "Инвентаризация не найдена");
  return audit;
}

export async function listAudits() {
  return prisma.inventoryAudit.findMany({
    orderBy: { startedAt: "desc" },
    include: {
      _count: { select: { counts: true } },
    },
  });
}

export async function submitAuditCounts(
  auditId: string,
  counts: AuditCountInput[],
  performedById: string
) {
  const audit = await prisma.inventoryAudit.findUnique({ where: { id: auditId } });
  if (!audit) throw new InventoryError("AUDIT_NOT_FOUND", "Инвентаризация не найдена");
  if (audit.status === "COMPLETED") {
    throw new InventoryError("AUDIT_COMPLETED", "Инвентаризация уже завершена");
  }

  await prisma.$transaction(async (tx) => {
    for (const count of counts) {
      const sku = await tx.inventorySku.findUnique({
        where: { id: count.skuId },
        select: { stockQuantity: true },
      });
      if (!sku) continue;

      const delta = count.actualQty - sku.stockQuantity;

      await tx.inventoryAuditCount.upsert({
        where: { auditId_skuId: { auditId, skuId: count.skuId } },
        create: {
          auditId,
          skuId: count.skuId,
          expectedQty: sku.stockQuantity,
          actualQty: count.actualQty,
          delta,
        },
        update: {
          expectedQty: sku.stockQuantity,
          actualQty: count.actualQty,
          delta,
        },
      });
    }
  });

  return getAudit(auditId);
}

export async function finalizeAudit(auditId: string, completedById: string) {
  const audit = await prisma.inventoryAudit.findUnique({
    where: { id: auditId },
    include: {
      counts: { include: { sku: { select: { stockQuantity: true, name: true } } } },
    },
  });
  if (!audit) throw new InventoryError("AUDIT_NOT_FOUND", "Инвентаризация не найдена");
  if (audit.status === "COMPLETED") {
    throw new InventoryError("AUDIT_COMPLETED", "Инвентаризация уже завершена");
  }
  if (audit.counts.length === 0) {
    throw new InventoryError("AUDIT_EMPTY", "Нет позиций для завершения инвентаризации");
  }

  await prisma.$transaction(async (tx) => {
    for (const count of audit.counts) {
      if (count.delta === 0) continue;

      // Apply adjustment to stock
      const updatedSku = await tx.inventorySku.update({
        where: { id: count.skuId },
        data: { stockQuantity: count.actualQty },
        select: { stockQuantity: true },
      });

      // Record movement
      await tx.stockMovement.create({
        data: {
          skuId: count.skuId,
          type: "AUDIT_ADJUSTMENT",
          delta: count.delta,
          balanceAfter: updatedSku.stockQuantity,
          referenceType: "AUDIT",
          referenceId: auditId,
          performedById: completedById,
          note: `Корректировка по итогам инвентаризации: ${count.delta > 0 ? "+" : ""}${count.delta}`,
        },
      });

      // Confirm count
      await tx.inventoryAuditCount.update({
        where: { id: count.id },
        data: { isConfirmed: true },
      });
    }

    await tx.inventoryAudit.update({
      where: { id: auditId },
      data: {
        status: "COMPLETED",
        completedById,
        completedAt: new Date(),
      },
    });
  });

  return getAudit(auditId);
}

// ============================================================
// STOCK MOVEMENTS LEDGER
// ============================================================

export async function listMovements(filter: MovementFilter) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;

  const where: Prisma.StockMovementWhereInput = {
    ...(filter.skuId && { skuId: filter.skuId }),
    ...(filter.type && { type: filter.type }),
    ...(filter.referenceType && { referenceType: filter.referenceType }),
    ...(filter.performedById && { performedById: filter.performedById }),
    ...((filter.dateFrom || filter.dateTo) && {
      createdAt: {
        ...(filter.dateFrom && { gte: new Date(filter.dateFrom) }),
        ...(filter.dateTo && { lte: new Date(`${filter.dateTo}T23:59:59.999Z`) }),
      },
    }),
  };

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: { sku: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return { movements, total, page, perPage };
}

// ============================================================
// CAFE INTEGRATION — menu auto-disable/enable
// ============================================================

export async function autoDisableMenuItems(skuId: string) {
  const sku = await prisma.inventorySku.findUnique({
    where: { id: skuId },
    select: { stockQuantity: true },
  });
  if (!sku || sku.stockQuantity > 0) return;

  // Disable menu items that are currently auto-available and linked to this SKU
  await prisma.menuItem.updateMany({
    where: {
      inventorySkuId: skuId,
      isAvailable: true,
      autoDisabledByStock: false,
    },
    data: {
      isAvailable: false,
      autoDisabledByStock: true,
    },
  });
}

export async function autoEnableMenuItems(skuId: string) {
  const sku = await prisma.inventorySku.findUnique({
    where: { id: skuId },
    select: { stockQuantity: true },
  });
  if (!sku || sku.stockQuantity <= 0) return;

  // Re-enable only items that were auto-disabled
  await prisma.menuItem.updateMany({
    where: {
      inventorySkuId: skuId,
      isAvailable: false,
      autoDisabledByStock: true,
    },
    data: {
      isAvailable: true,
      autoDisabledByStock: false,
    },
  });
}

export async function linkMenuItemToSku(menuItemId: string, inventorySkuId: string | null) {
  return prisma.menuItem.update({
    where: { id: menuItemId },
    data: {
      inventorySkuId,
      // Reset auto-disable state when relinking
      ...(inventorySkuId === null && { autoDisabledByStock: false }),
    },
    select: { id: true, name: true, inventorySkuId: true, autoDisabledByStock: true },
  });
}

// ============================================================
// DASHBOARD (SUPERADMIN)
// ============================================================

export async function getInventoryDashboard() {
  const [skus, recentMovements] = await Promise.all([
    prisma.inventorySku.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        lowStockThreshold: true,
        price: true,
        batches: {
          where: { isExhausted: false },
          select: { costPerUnit: true, remainingQty: true },
        },
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        type: "SALE",
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      include: { sku: { select: { id: true, name: true, price: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Stock value at purchase price
  let totalStockValueAtCost = 0;
  let totalPotentialRevenue = 0;
  let outOfStockCount = 0;
  let belowThresholdCount = 0;

  for (const sku of skus) {
    const salePrice = Number(sku.price);
    totalPotentialRevenue += salePrice * sku.stockQuantity;

    for (const batch of sku.batches) {
      if (batch.costPerUnit) {
        totalStockValueAtCost += Number(batch.costPerUnit) * batch.remainingQty;
      }
    }

    if (sku.stockQuantity === 0) outOfStockCount++;
    else if (sku.stockQuantity < sku.lowStockThreshold) belowThresholdCount++;
  }

  const grossMargin =
    totalPotentialRevenue > 0
      ? ((totalPotentialRevenue - totalStockValueAtCost) / totalPotentialRevenue) * 100
      : 0;

  // Top sellers (last 30 days)
  const skuSales: Record<string, { id: string; name: string; qty: number; revenue: number }> = {};
  for (const m of recentMovements) {
    const qty = Math.abs(m.delta);
    const revenue = Number(m.sku.price) * qty;
    if (!skuSales[m.skuId]) {
      skuSales[m.skuId] = { id: m.skuId, name: m.sku.name, qty: 0, revenue: 0 };
    }
    skuSales[m.skuId].qty += qty;
    skuSales[m.skuId].revenue += revenue;
  }

  const topSellers = Object.values(skuSales)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // Write-offs (last 30 days)
  const writeOffs = await prisma.writeOff.aggregate({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    _sum: { quantity: true },
  });

  return {
    totalStockValueAtCost: totalStockValueAtCost.toFixed(2),
    totalPotentialRevenue: totalPotentialRevenue.toFixed(2),
    grossMarginPercent: grossMargin.toFixed(1),
    stockStatus: {
      outOfStock: outOfStockCount,
      belowThreshold: belowThresholdCount,
      healthy: skus.length - outOfStockCount - belowThresholdCount,
      total: skus.length,
    },
    topSellers30Days: topSellers.map((s) => ({
      ...s,
      revenue: s.revenue.toFixed(2),
    })),
    writeOffsQty30Days: writeOffs._sum.quantity ?? 0,
  };
}

// ============================================================
// HELPERS
// ============================================================

const WRITE_OFF_REASON_LABELS: Record<string, string> = {
  EXPIRED: "Истёк срок годности",
  DAMAGED: "Повреждён",
  LOST: "Утерян",
  OTHER: "Иное",
};
