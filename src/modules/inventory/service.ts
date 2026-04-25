import { prisma } from "@/lib/db";
import type { InventoryTransactionType, Prisma } from "@prisma/client";
import { recalculateStock } from "./stock";
import { InventoryError } from "./errors";
import type {
  CreateSkuInput,
  UpdateSkuInput,
  ReceiveInput,
  AdjustInput,
  TransactionFilter,
  BookingItemInput,
  BookingItemSnapshot,
  InventoryAnalytics,
  ReceiptHistoryRow,
} from "./types";

// === SKU MANAGEMENT ===

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function listPublicSkus() {
  return prisma.inventorySku.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      category: true,
      unit: true,
      price: true,
      stockQuantity: true,
      isActive: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function listAllSkus(filter?: {
  category?: string;
  isActive?: boolean;
}) {
  return prisma.inventorySku.findMany({
    where: {
      ...(filter?.category && { category: filter.category }),
      ...(filter?.isActive !== undefined && { isActive: filter.isActive }),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function getSku(id: string) {
  return prisma.inventorySku.findUnique({ where: { id } });
}

export async function createSku(
  input: CreateSkuInput,
  performedById: string
) {
  const { initialStock, ...skuData } = input;
  const normalizedName = normalizeName(skuData.name);

  const duplicate = await prisma.inventorySku.findFirst({
    where: { name: { equals: normalizedName, mode: "insensitive" } },
  });
  if (duplicate) {
    throw new InventoryError(
      "SKU_DUPLICATE",
      `Товар "${duplicate.name}" уже существует`,
      { existingSkuId: duplicate.id, existingSkuName: duplicate.name }
    );
  }

  const sku = await prisma.$transaction(async (tx) => {
    const created = await tx.inventorySku.create({
      data: {
        name: normalizedName,
        category: skuData.category,
        unit: skuData.unit ?? "шт",
        price: skuData.price,
        lowStockThreshold: skuData.lowStockThreshold ?? 5,
        stockQuantity: initialStock ?? 0,
      },
    });

    if (initialStock && initialStock > 0) {
      await tx.inventoryTransaction.create({
        data: {
          skuId: created.id,
          type: "INITIAL",
          quantity: initialStock,
          performedById,
          note: "Начальный остаток",
        },
      });
    }

    return created;
  });

  return sku;
}

export async function updateSku(id: string, input: UpdateSkuInput) {
  const existing = await getSku(id);
  if (!existing) throw new InventoryError("SKU_NOT_FOUND", "Товар не найден");

  return prisma.inventorySku.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.price !== undefined && { price: input.price }),
      ...(input.lowStockThreshold !== undefined && {
        lowStockThreshold: input.lowStockThreshold,
      }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function archiveSku(id: string) {
  const existing = await getSku(id);
  if (!existing) throw new InventoryError("SKU_NOT_FOUND", "Товар не найден");

  return prisma.inventorySku.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, isActive: true },
  });
}

// === RECEIPT (incoming stock) ===

export async function receiveStock(input: ReceiveInput, performedById: string) {
  const sku = await getSku(input.skuId);
  if (!sku || !sku.isActive)
    throw new InventoryError("SKU_NOT_FOUND", "Товар не найден или неактивен");

  const result = await prisma.$transaction(async (tx) => {
    const effectiveReceivedAt = input.receivedAt ?? new Date();

    const transaction = await tx.inventoryTransaction.create({
      data: {
        skuId: input.skuId,
        type: "RECEIPT",
        quantity: input.quantity,
        performedById,
        note: input.note,
        receivedAt: effectiveReceivedAt,
      },
    });

    // Create StockBatch linked to this RECEIPT tx (required for invariant and edit cascade).
    const batch = await tx.stockBatch.create({
      data: {
        skuId: input.skuId,
        receiptTxId: transaction.id,
        initialQty: input.quantity,
        remainingQty: input.quantity,
        receiptDate: effectiveReceivedAt,
      },
    });

    const { newStockQuantity } = await recalculateStock(tx, input.skuId);

    await tx.stockMovement.create({
      data: {
        skuId: input.skuId,
        batchId: batch.id,
        type: "RECEIPT",
        delta: input.quantity,
        balanceAfter: newStockQuantity,
        referenceType: "RECEIPT",
        referenceId: transaction.id,
        performedById,
        note: input.note ?? `Приход +${input.quantity}`,
      },
    });

    return {
      transactionId: transaction.id,
      skuId: input.skuId,
      newStockQuantity,
    };
  });

  return result;
}

/**
 * Receive stock by free-text name.
 * Finds existing SKU by name (case-insensitive) or creates a new one.
 * receivedAt — фактическая дата прихода (AC-3.1). Fallback — текущая дата.
 */
export async function receiveStockByName(
  name: string,
  quantity: number,
  note: string | undefined,
  performedById: string,
  receivedAt?: Date
) {
  const effectiveReceivedAt = receivedAt ?? new Date();
  const normalizedName = normalizeName(name);

  const existing = await prisma.inventorySku.findFirst({
    where: { name: { equals: normalizedName, mode: "insensitive" } },
  });

  return prisma.$transaction(async (tx) => {
    let skuId: string;
    let newStockQuantity: number;
    const isNewSku = !existing;

    if (existing) {
      // SKU exists — record RECEIPT, create linked batch, recalc stock
      skuId = existing.id;
      const transaction = await tx.inventoryTransaction.create({
        data: { skuId, type: "RECEIPT", quantity, performedById, note, receivedAt: effectiveReceivedAt },
      });

      const batch = await tx.stockBatch.create({
        data: {
          skuId,
          receiptTxId: transaction.id,
          initialQty: quantity,
          remainingQty: quantity,
          receiptDate: effectiveReceivedAt,
        },
      });

      const recalc = await recalculateStock(tx, skuId);
      newStockQuantity = recalc.newStockQuantity;

      await tx.stockMovement.create({
        data: {
          skuId,
          batchId: batch.id,
          type: "RECEIPT",
          delta: quantity,
          balanceAfter: newStockQuantity,
          referenceType: "RECEIPT",
          referenceId: transaction.id,
          performedById,
          note: note ?? `Приход: ${name} +${quantity}`,
        },
      });
    } else {
      // New item — create SKU + INITIAL transaction + linked batch
      const sku = await tx.inventorySku.create({
        data: {
          name: normalizedName,
          category: "Товары",
          unit: "шт",
          price: 0,
          stockQuantity: 0, // real value comes from recalculateStock below
          lowStockThreshold: 5,
        },
      });
      skuId = sku.id;
      const transaction = await tx.inventoryTransaction.create({
        data: { skuId, type: "INITIAL", quantity, performedById, note: note ?? "Первый приход", receivedAt: effectiveReceivedAt },
      });

      const batch = await tx.stockBatch.create({
        data: {
          skuId,
          receiptTxId: transaction.id,
          initialQty: quantity,
          remainingQty: quantity,
          receiptDate: effectiveReceivedAt,
        },
      });

      const recalc = await recalculateStock(tx, skuId);
      newStockQuantity = recalc.newStockQuantity;

      await tx.stockMovement.create({
        data: {
          skuId,
          batchId: batch.id,
          type: "RECEIPT",
          delta: quantity,
          balanceAfter: newStockQuantity,
          referenceType: "RECEIPT",
          referenceId: transaction.id,
          performedById,
          note: note ?? `Начальный остаток: ${name} +${quantity}`,
        },
      });
    }

    return { skuId, newStockQuantity, name, isNewSku };
  });
}

/**
 * List the last N RECEIPT and INITIAL transactions, sorted by receivedAt desc.
 * Falls back to createdAt for rows where receivedAt is null (AC-3.4).
 */
export async function listReceipts(limit = 50): Promise<ReceiptHistoryRow[]> {
  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      type: { in: ["RECEIPT", "INITIAL"] },
      isVoided: false,
    },
    include: {
      sku: { select: { name: true } },
    },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  const userIds = [...new Set(rows.map((r) => r.performedById))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    id: r.id,
    skuId: r.skuId,
    skuName: r.sku.name,
    type: r.type as "RECEIPT" | "INITIAL",
    quantity: r.quantity,
    note: r.note,
    performedById: r.performedById,
    performedByName: userMap.get(r.performedById) ?? null,
    receivedAt: (r.receivedAt ?? r.createdAt).toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

// === ADJUSTMENT (inventory correction) ===

export async function adjustStock(input: AdjustInput, performedById: string) {
  const sku = await getSku(input.skuId);
  if (!sku) throw new InventoryError("SKU_NOT_FOUND", "Товар не найден");

  const delta = input.targetQuantity - sku.stockQuantity;
  if (delta === 0) {
    throw new InventoryError(
      "NO_CHANGE",
      "Целевой остаток совпадает с текущим"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.inventoryTransaction.create({
      data: {
        skuId: input.skuId,
        type: "ADJUSTMENT",
        quantity: Math.abs(delta),
        performedById,
        note: `${input.note} (${delta > 0 ? "+" : ""}${delta} шт)`,
      },
    });

    // Keep batches consistent with the new target stock.
    if (delta > 0) {
      // Add a synthetic adjustment batch — acts like a receipt with no receiptTxId link.
      await tx.stockBatch.create({
        data: {
          skuId: input.skuId,
          initialQty: delta,
          remainingQty: delta,
          receiptDate: new Date(),
        },
      });
    } else {
      // delta < 0: deduct FIFO across existing batches until |delta| is consumed.
      let remaining = -delta;
      const batches = await tx.stockBatch.findMany({
        where: { skuId: input.skuId, isExhausted: false, remainingQty: { gt: 0 } },
        orderBy: [{ expiresAt: "asc" }, { receiptDate: "asc" }],
      });
      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.remainingQty, remaining);
        const newR = batch.remainingQty - take;
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { remainingQty: newR, isExhausted: newR === 0 },
        });
        remaining -= take;
      }
      // If batches couldn't cover the full decrement (historical data with bare stockQuantity),
      // the invariant converges to whatever batches hold — stock cannot go below 0.
      // This is acceptable: adjustStock is a corrective inventory operation.
      void remaining;
    }

    const { newStockQuantity } = await recalculateStock(tx, input.skuId);

    return {
      transactionId: transaction.id,
      skuId: input.skuId,
      previousStock: sku.stockQuantity,
      newStockQuantity,
      delta,
    };
  });

  return result;
}

// === TRANSACTIONS ===

export async function listTransactions(filter: TransactionFilter) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 50;

  const where: Prisma.InventoryTransactionWhereInput = {
    ...(filter.skuId && { skuId: filter.skuId }),
    ...(filter.type && { type: filter.type }),
    ...(filter.bookingId && { bookingId: filter.bookingId }),
    ...(filter.moduleSlug && { moduleSlug: filter.moduleSlug }),
    ...(filter.isVoided !== undefined && { isVoided: filter.isVoided }),
    ...((filter.dateFrom || filter.dateTo) && {
      createdAt: {
        ...(filter.dateFrom && { gte: new Date(filter.dateFrom) }),
        ...(filter.dateTo && {
          lte: new Date(`${filter.dateTo}T23:59:59.999Z`),
        }),
      },
    }),
  };

  const [transactions, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: { sku: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return { transactions, total, page, perPage };
}

export async function voidTransaction(
  id: string,
  performedById: string,
  note?: string
) {
  const transaction = await prisma.inventoryTransaction.findUnique({
    where: { id },
    include: { sku: { select: { stockQuantity: true } } },
  });

  if (!transaction)
    throw new InventoryError("TRANSACTION_NOT_FOUND", "Транзакция не найдена");
  if (transaction.isVoided)
    throw new InventoryError(
      "TRANSACTION_ALREADY_VOIDED",
      "Транзакция уже аннулирована"
    );

  // Calculate stock effect of voiding
  const stockEffect = getVoidEffect(transaction.type, transaction.quantity);
  const newStock = transaction.sku.stockQuantity + stockEffect;

  if (newStock < 0) {
    throw new InventoryError(
      "STOCK_WOULD_GO_NEGATIVE",
      "Аннулирование приведёт к отрицательному остатку"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const voided = await tx.inventoryTransaction.update({
      where: { id },
      data: {
        isVoided: true,
        note: note
          ? `${transaction.note ?? ""} | Аннулировано: ${note}`
          : transaction.note,
      },
    });

    // Compensate batches so the invariant sum(batch.remainingQty) === sku.stockQuantity holds.
    if (transaction.type === "RECEIPT" || transaction.type === "INITIAL") {
      // Voiding a receipt removes stock: zero out the associated batch (if unconsumed).
      const batch = await tx.stockBatch.findFirst({
        where: { receiptTxId: id },
      });
      if (batch) {
        const consumed = batch.initialQty - batch.remainingQty;
        if (consumed > 0) {
          throw new InventoryError(
            "RECEIPT_PARTIALLY_SOLD",
            `Нельзя аннулировать приход: уже списано ${consumed}`
          );
        }
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { remainingQty: 0, isExhausted: true },
        });
      } else {
        // No linked batch (legacy): deduct FIFO across any existing batches.
        let remaining = transaction.quantity;
        const batches = await tx.stockBatch.findMany({
          where: { skuId: transaction.skuId, isExhausted: false, remainingQty: { gt: 0 } },
          orderBy: [{ expiresAt: "asc" }, { receiptDate: "asc" }],
        });
        for (const b of batches) {
          if (remaining <= 0) break;
          const take = Math.min(b.remainingQty, remaining);
          const newR = b.remainingQty - take;
          await tx.stockBatch.update({
            where: { id: b.id },
            data: { remainingQty: newR, isExhausted: newR === 0 },
          });
          remaining -= take;
        }
      }
    } else if (transaction.type === "SALE" || transaction.type === "ADJUSTMENT") {
      // Voiding a sale/adjustment restores stock: add a synthetic compensating batch.
      if (stockEffect > 0) {
        await tx.stockBatch.create({
          data: {
            skuId: transaction.skuId,
            initialQty: stockEffect,
            remainingQty: stockEffect,
            receiptDate: new Date(),
          },
        });
      }
    } else if (transaction.type === "RETURN") {
      // Voiding a return removes the restored stock: FIFO deduct.
      let remaining = transaction.quantity;
      const batches = await tx.stockBatch.findMany({
        where: { skuId: transaction.skuId, isExhausted: false, remainingQty: { gt: 0 } },
        orderBy: [{ expiresAt: "asc" }, { receiptDate: "asc" }],
      });
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(b.remainingQty, remaining);
        const newR = b.remainingQty - take;
        await tx.stockBatch.update({
          where: { id: b.id },
          data: { remainingQty: newR, isExhausted: newR === 0 },
        });
        remaining -= take;
      }
    }

    const { newStockQuantity } = await recalculateStock(tx, transaction.skuId);

    return {
      transactionId: voided.id,
      isVoided: true,
      skuId: transaction.skuId,
      newStockQuantity,
    };
  });

  return result;
}

function getVoidEffect(
  type: InventoryTransactionType,
  quantity: number
): number {
  switch (type) {
    case "RECEIPT":
    case "INITIAL":
      return -quantity; // voiding a receipt removes stock
    case "SALE":
    case "ADJUSTMENT":
      return quantity; // voiding a sale restores stock
    case "RETURN":
      return -quantity; // voiding a return removes the restored stock
  }
}

// === BOOKING INTEGRATION ===

/**
 * Validate booking items and build snapshot for storage in metadata.
 * Does NOT deduct stock — called during PENDING booking creation.
 */
export async function validateAndSnapshotItems(
  items: BookingItemInput[]
): Promise<{ snapshots: BookingItemSnapshot[]; itemsTotal: number }> {
  if (items.length === 0)
    return { snapshots: [], itemsTotal: 0 };

  const skuIds = items.map((i) => i.skuId);
  const skus = await prisma.inventorySku.findMany({
    where: { id: { in: skuIds }, isActive: true },
    select: { id: true, name: true, price: true, stockQuantity: true },
  });

  if (skus.length !== items.length) {
    const foundIds = new Set(skus.map((s) => s.id));
    const missing = skuIds.filter((id) => !foundIds.has(id));
    throw new InventoryError(
      "INVALID_SKU",
      `Товары не найдены или неактивны: ${missing.join(", ")}`
    );
  }

  const insufficient = [];
  const snapshots: BookingItemSnapshot[] = [];
  let itemsTotal = 0;

  for (const item of items) {
    const sku = skus.find((s) => s.id === item.skuId)!;
    if (sku.stockQuantity < item.quantity) {
      insufficient.push({ name: sku.name, available: sku.stockQuantity });
    } else {
      const price = Number(sku.price);
      snapshots.push({
        skuId: sku.id,
        skuName: sku.name,
        quantity: item.quantity,
        priceAtBooking: sku.price.toString(),
      });
      itemsTotal += price * item.quantity;
    }
  }

  if (insufficient.length > 0) {
    throw new InventoryError(
      "INVENTORY_INSUFFICIENT",
      `Недостаточно товара: ${insufficient.map((i) => `${i.name} (доступно: ${i.available})`).join(", ")}`
    );
  }

  return { snapshots, itemsTotal };
}

/**
 * Deduct stock for confirmed booking items.
 * Called inside a prisma.$transaction.
 */
export async function saleBookingItems(
  tx: Prisma.TransactionClient,
  bookingId: string,
  moduleSlug: string,
  items: BookingItemSnapshot[],
  performedById: string
) {
  for (const item of items) {
    // Re-check stock inside transaction (race condition protection)
    const sku = await tx.inventorySku.findUnique({
      where: { id: item.skuId },
      select: { stockQuantity: true, isActive: true },
    });

    if (!sku || sku.stockQuantity < item.quantity) {
      throw new InventoryError(
        "INVENTORY_INSUFFICIENT",
        `Недостаточно товара: ${item.skuName}`
      );
    }

    await tx.inventoryTransaction.create({
      data: {
        skuId: item.skuId,
        type: "SALE",
        quantity: item.quantity,
        bookingId,
        moduleSlug,
        performedById,
        note: `Продажа при бронировании ${bookingId}`,
      },
    });

    // FIFO deduct from batches.
    let remaining = item.quantity;
    const batches = await tx.stockBatch.findMany({
      where: { skuId: item.skuId, isExhausted: false, remainingQty: { gt: 0 } },
      orderBy: [{ expiresAt: "asc" }, { receiptDate: "asc" }],
    });
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.remainingQty, remaining);
      const newR = batch.remainingQty - take;
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { remainingQty: newR, isExhausted: newR === 0 },
      });
      remaining -= take;
    }

    await recalculateStock(tx, item.skuId);
  }
}

/**
 * Return stock for cancelled confirmed booking items.
 * Called inside a prisma.$transaction.
 */
export async function returnBookingItems(
  tx: Prisma.TransactionClient,
  bookingId: string,
  moduleSlug: string,
  items: BookingItemSnapshot[],
  performedById: string
) {
  for (const item of items) {
    await tx.inventoryTransaction.create({
      data: {
        skuId: item.skuId,
        type: "RETURN",
        quantity: item.quantity,
        bookingId,
        moduleSlug,
        performedById,
        note: `Возврат при отмене бронирования ${bookingId}`,
      },
    });

    // Return: add a compensating batch with returned quantity.
    await tx.stockBatch.create({
      data: {
        skuId: item.skuId,
        initialQty: item.quantity,
        remainingQty: item.quantity,
        receiptDate: new Date(),
      },
    });

    await recalculateStock(tx, item.skuId);
  }
}

// === ANALYTICS ===

export async function getAnalytics(
  dateFrom?: string,
  dateTo?: string
): Promise<InventoryAnalytics> {
  const dateFilter =
    dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom && { gte: new Date(dateFrom) }),
            ...(dateTo && { lte: new Date(`${dateTo}T23:59:59.999Z`) }),
          },
        }
      : {};

  const [allSkus, salesTransactions] = await Promise.all([
    prisma.inventorySku.findMany({
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        lowStockThreshold: true,
        isActive: true,
      },
    }),
    prisma.inventoryTransaction.findMany({
      where: { type: "SALE", isVoided: false, ...dateFilter },
      include: { sku: { select: { name: true, price: true } } },
    }),
  ]);

  const lowStockSkus = allSkus.filter(
    (s) => s.isActive && s.stockQuantity < s.lowStockThreshold
  );

  // Sales by module
  const salesByModule: Record<
    string,
    { totalItems: number; totalRevenue: number }
  > = {};

  // Top SKUs
  const skuSales: Record<
    string,
    { id: string; name: string; soldQuantity: number; revenue: number }
  > = {};

  for (const t of salesTransactions) {
    const modSlug = t.moduleSlug ?? "unknown";
    const price = Number(t.sku.price);
    const revenue = price * t.quantity;

    if (!salesByModule[modSlug]) {
      salesByModule[modSlug] = { totalItems: 0, totalRevenue: 0 };
    }
    salesByModule[modSlug].totalItems += t.quantity;
    salesByModule[modSlug].totalRevenue += revenue;

    if (!skuSales[t.skuId]) {
      skuSales[t.skuId] = {
        id: t.skuId,
        name: t.sku.name,
        soldQuantity: 0,
        revenue: 0,
      };
    }
    skuSales[t.skuId].soldQuantity += t.quantity;
    skuSales[t.skuId].revenue += revenue;
  }

  const topSkus = Object.values(skuSales)
    .sort((a, b) => b.soldQuantity - a.soldQuantity)
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      name: s.name,
      soldQuantity: s.soldQuantity,
      revenue: s.revenue.toFixed(2),
    }));

  const salesByModuleFormatted: Record<
    string,
    { totalItems: number; totalRevenue: string }
  > = {};
  for (const [key, val] of Object.entries(salesByModule)) {
    salesByModuleFormatted[key] = {
      totalItems: val.totalItems,
      totalRevenue: val.totalRevenue.toFixed(2),
    };
  }

  return {
    totalSkus: allSkus.length,
    lowStockSkus: lowStockSkus.map((s) => ({
      id: s.id,
      name: s.name,
      stockQuantity: s.stockQuantity,
      lowStockThreshold: s.lowStockThreshold,
    })),
    salesByModule: salesByModuleFormatted,
    topSkus,
    period: {
      from: dateFrom ?? "all",
      to: dateTo ?? "all",
    },
  };
}

// === HEALTH ===

export async function getHealth() {
  const [totalSkus, activeSkus, allActive] = await Promise.all([
    prisma.inventorySku.count(),
    prisma.inventorySku.count({ where: { isActive: true } }),
    prisma.inventorySku.findMany({
      where: { isActive: true },
      select: { stockQuantity: true, lowStockThreshold: true },
    }),
  ]);

  const lowStockCount = allActive.filter(
    (s) => s.stockQuantity < s.lowStockThreshold
  ).length;

  return { status: "ok" as const, totalSkus, activeSkus, lowStockCount };
}

// === SKU MERGE ===

/**
 * Merge duplicate SKUs: moves all stock, movements, receipts, write-offs and
 * audit counts from sourceId → targetId, then archives the source.
 * SUPERADMIN-only operation.
 */
export async function mergeSku(sourceId: string, targetId: string, performedById: string) {
  if (sourceId === targetId) {
    throw new InventoryError("MERGE_SAME", "Нельзя объединить товар с самим собой");
  }

  const [source, target] = await Promise.all([getSku(sourceId), getSku(targetId)]);
  if (!source) throw new InventoryError("SKU_NOT_FOUND", "Исходный товар не найден");
  if (!target) throw new InventoryError("SKU_NOT_FOUND", "Целевой товар не найден");

  await prisma.$transaction(async (tx) => {
    await tx.stockBatch.updateMany({ where: { skuId: sourceId }, data: { skuId: targetId } });
    await tx.stockReceiptItem.updateMany({ where: { skuId: sourceId }, data: { skuId: targetId } });
    await tx.stockMovement.updateMany({ where: { skuId: sourceId }, data: { skuId: targetId } });
    await tx.inventoryTransaction.updateMany({ where: { skuId: sourceId }, data: { skuId: targetId } });
    await tx.writeOff.updateMany({ where: { skuId: sourceId }, data: { skuId: targetId } });
    await tx.menuItem.updateMany({ where: { inventorySkuId: sourceId }, data: { inventorySkuId: targetId } });

    // InventoryAuditCount has @@unique([auditId, skuId]) — handle conflicts by summing counts
    const sourceCounts = await tx.inventoryAuditCount.findMany({ where: { skuId: sourceId } });
    for (const ac of sourceCounts) {
      const conflict = await tx.inventoryAuditCount.findUnique({
        where: { auditId_skuId: { auditId: ac.auditId, skuId: targetId } },
      });
      if (conflict) {
        const mergedActual = conflict.actualQty + ac.actualQty;
        const mergedExpected = conflict.expectedQty + ac.expectedQty;
        await tx.inventoryAuditCount.update({
          where: { auditId_skuId: { auditId: ac.auditId, skuId: targetId } },
          data: { actualQty: mergedActual, expectedQty: mergedExpected, delta: mergedActual - mergedExpected },
        });
        await tx.inventoryAuditCount.delete({ where: { id: ac.id } });
      } else {
        await tx.inventoryAuditCount.update({ where: { id: ac.id }, data: { skuId: targetId } });
      }
    }

    await recalculateStock(tx, targetId);

    await tx.inventorySku.update({
      where: { id: sourceId },
      data: { isActive: false, name: `[Объединён → ${target.name}] ${source.name}` },
    });
  });

  const updatedTarget = await getSku(targetId);
  return {
    mergedSourceId: sourceId,
    targetId,
    targetName: target.name,
    newStockQuantity: Number(updatedTarget?.stockQuantity ?? 0),
    performedById,
  };
}

// === ERROR CLASS ===
// Re-exported for backward compatibility with callers that import from "./service".
export { InventoryError } from "./errors";
