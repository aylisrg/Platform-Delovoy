import { prisma } from "@/lib/db";
import type { InventoryTransactionType, Prisma } from "@prisma/client";
import type {
  CreateSkuInput,
  UpdateSkuInput,
  ReceiveInput,
  AdjustInput,
  TransactionFilter,
  BookingItemInput,
  BookingItemSnapshot,
  InventoryAnalytics,
} from "./types";

// === SKU MANAGEMENT ===

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

  const sku = await prisma.$transaction(async (tx) => {
    const created = await tx.inventorySku.create({
      data: {
        name: skuData.name,
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
    const transaction = await tx.inventoryTransaction.create({
      data: {
        skuId: input.skuId,
        type: "RECEIPT",
        quantity: input.quantity,
        performedById,
        note: input.note,
      },
    });

    const updated = await tx.inventorySku.update({
      where: { id: input.skuId },
      data: { stockQuantity: { increment: input.quantity } },
      select: { stockQuantity: true },
    });

    return { transactionId: transaction.id, skuId: input.skuId, newStockQuantity: updated.stockQuantity };
  });

  return result;
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

    const updated = await tx.inventorySku.update({
      where: { id: input.skuId },
      data: { stockQuantity: input.targetQuantity },
      select: { stockQuantity: true },
    });

    return {
      transactionId: transaction.id,
      skuId: input.skuId,
      previousStock: sku.stockQuantity,
      newStockQuantity: updated.stockQuantity,
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

    const updated = await tx.inventorySku.update({
      where: { id: transaction.skuId },
      data: { stockQuantity: { increment: stockEffect } },
      select: { stockQuantity: true },
    });

    return {
      transactionId: voided.id,
      isVoided: true,
      skuId: transaction.skuId,
      newStockQuantity: updated.stockQuantity,
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

    await tx.inventorySku.update({
      where: { id: item.skuId },
      data: { stockQuantity: { decrement: item.quantity } },
    });
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

    await tx.inventorySku.update({
      where: { id: item.skuId },
      data: { stockQuantity: { increment: item.quantity } },
    });
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
    const module = t.moduleSlug ?? "unknown";
    const price = Number(t.sku.price);
    const revenue = price * t.quantity;

    if (!salesByModule[module]) {
      salesByModule[module] = { totalItems: 0, totalRevenue: 0 };
    }
    salesByModule[module].totalItems += t.quantity;
    salesByModule[module].totalRevenue += revenue;

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

// === ERROR CLASS ===

export class InventoryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "InventoryError";
  }
}
