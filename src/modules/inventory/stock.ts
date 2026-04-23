import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { InventoryError } from "./errors";
import type { UpdateReceiptInput, DeleteReceiptInput } from "./types";

/**
 * Recalculate InventorySku.stockQuantity as the sum of remainingQty across all
 * non-exhausted StockBatches for the given SKU, within a Prisma transaction.
 *
 * Invariant: SUM(batch.remainingQty WHERE skuId = X AND isExhausted = false)
 *            === InventorySku.stockQuantity
 *
 * Must be called at the end of every mutation that changes batch quantities
 * (receive, edit receipt, delete receipt, sale, return, adjust, void, write-off).
 *
 * @returns summary of the recalculation
 */
export async function recalculateStock(
  tx: Prisma.TransactionClient,
  skuId: string
): Promise<{ skuId: string; newStockQuantity: number; batchesCount: number }> {
  const agg = await tx.stockBatch.aggregate({
    where: { skuId, isExhausted: false },
    _sum: { remainingQty: true },
    _count: true,
  });

  const newStockQuantity = agg._sum.remainingQty ?? 0;

  await tx.inventorySku.update({
    where: { id: skuId },
    data: { stockQuantity: newStockQuantity },
  });

  return {
    skuId,
    newStockQuantity,
    batchesCount: agg._count,
  };
}

/**
 * Edit an existing legacy receipt transaction (RECEIPT or INITIAL).
 *
 * Updates the parent InventoryTransaction (quantity, receivedAt, note) and
 * cascade-updates the linked StockBatch (via receiptTxId), then recalculates
 * sku.stockQuantity.
 *
 * Safety:
 *  - Refuses to reduce quantity below what has already been consumed from the batch
 *    (otherwise stock would go negative).
 *  - Rejects editing a voided transaction.
 *  - Rejects editing non-RECEIPT/INITIAL transactions.
 */
export async function updateReceipt(
  receiptTxId: string,
  input: UpdateReceiptInput,
  performedById: string
): Promise<{ receiptId: string; skuId: string; newStockQuantity: number; delta: number }> {
  const existing = await prisma.inventoryTransaction.findUnique({
    where: { id: receiptTxId },
  });
  if (!existing) {
    throw new InventoryError("RECEIPT_NOT_FOUND", "Приход не найден");
  }
  if (existing.isVoided) {
    throw new InventoryError(
      "RECEIPT_VOIDED",
      "Нельзя редактировать аннулированный приход"
    );
  }
  if (existing.type !== "RECEIPT" && existing.type !== "INITIAL") {
    throw new InventoryError(
      "NOT_A_RECEIPT",
      "Редактирование поддерживается только для приходов (RECEIPT/INITIAL)"
    );
  }

  return prisma.$transaction(async (tx) => {
    const newQuantity = input.quantity ?? existing.quantity;
    const newReceivedAt = input.receivedAt ?? existing.receivedAt ?? existing.createdAt;
    const delta = newQuantity - existing.quantity;

    // Find the batch linked to this receipt (may be null for legacy pre-backfill receipts).
    const batch = await tx.stockBatch.findFirst({
      where: { receiptTxId },
    });

    if (batch) {
      const consumed = batch.initialQty - batch.remainingQty;
      if (newQuantity < consumed) {
        throw new InventoryError(
          "RECEIPT_PARTIALLY_SOLD",
          `Нельзя уменьшить приход до ${newQuantity}: уже списано ${consumed}`
        );
      }
      const newRemaining = batch.remainingQty + delta;
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: {
          initialQty: newQuantity,
          remainingQty: newRemaining,
          isExhausted: newRemaining === 0,
          receiptDate: newReceivedAt,
        },
      });
    } else if (delta !== 0) {
      // No linked batch (historical). Create a compensating batch to keep invariant.
      // Historical stockQuantity was set by legacy receiveStock which didn't create a batch.
      // We create a fresh batch representing the delta only, not the full quantity, because
      // we don't know what part of stockQuantity originated from this specific receipt.
      if (delta > 0) {
        await tx.stockBatch.create({
          data: {
            skuId: existing.skuId,
            receiptTxId,
            initialQty: delta,
            remainingQty: delta,
            receiptDate: newReceivedAt,
          },
        });
      } else {
        // Cannot safely subtract without a source batch; refuse to avoid corruption.
        throw new InventoryError(
          "RECEIPT_NOT_LINKED_TO_BATCH",
          "Нельзя уменьшить приход без связанной партии (legacy data). Аннулируйте приход и создайте новый."
        );
      }
    }

    // Update the transaction itself.
    await tx.inventoryTransaction.update({
      where: { id: receiptTxId },
      data: {
        quantity: newQuantity,
        receivedAt: newReceivedAt,
        ...(input.note !== undefined && { note: input.note }),
      },
    });

    const { newStockQuantity } = await recalculateStock(tx, existing.skuId);

    // Note: route handler writes AuditLog. We only log via note field above.
    void performedById;

    return {
      receiptId: receiptTxId,
      skuId: existing.skuId,
      newStockQuantity,
      delta,
    };
  });
}

/**
 * Hard-delete a legacy receipt transaction.
 * - If the linked batch still has remainingQty === initialQty (nothing sold from it),
 *   delete batch + tx and recalc.
 * - If partially consumed, refuse (409).
 */
export async function deleteReceipt(
  receiptTxId: string,
  performedById: string,
  input: DeleteReceiptInput
): Promise<{ receiptId: string; skuId: string; newStockQuantity: number }> {
  const existing = await prisma.inventoryTransaction.findUnique({
    where: { id: receiptTxId },
  });
  if (!existing) {
    throw new InventoryError("RECEIPT_NOT_FOUND", "Приход не найден");
  }
  if (existing.type !== "RECEIPT" && existing.type !== "INITIAL") {
    throw new InventoryError(
      "NOT_A_RECEIPT",
      "Удаление поддерживается только для приходов (RECEIPT/INITIAL)"
    );
  }

  return prisma.$transaction(async (tx) => {
    const batch = await tx.stockBatch.findFirst({ where: { receiptTxId } });
    if (batch) {
      const consumed = batch.initialQty - batch.remainingQty;
      if (consumed > 0) {
        throw new InventoryError(
          "RECEIPT_PARTIALLY_SOLD",
          `Нельзя удалить приход: уже списано ${consumed} из ${batch.initialQty}`
        );
      }
      await tx.stockMovement.deleteMany({ where: { batchId: batch.id } });
      await tx.stockBatch.delete({ where: { id: batch.id } });
    }

    await tx.inventoryTransaction.delete({ where: { id: receiptTxId } });

    const { newStockQuantity } = await recalculateStock(tx, existing.skuId);

    void performedById;
    void input;

    return {
      receiptId: receiptTxId,
      skuId: existing.skuId,
      newStockQuantity,
    };
  });
}
