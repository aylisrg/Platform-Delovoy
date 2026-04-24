import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiNotFound,
  apiValidationError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit, logEvent } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { canConfirmReceipt, canCorrectReceipt, canEditModule, hasModuleAccess } from "@/lib/permissions";
import {
  getReceipt,
  editDraftReceipt,
  confirmReceipt,
  correctReceipt,
  InventoryError,
} from "@/modules/inventory/service-v2";
import { editReceiptSchema } from "@/modules/inventory/validation";
import { recalculateStock } from "@/modules/inventory/stock";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const receipt = await getReceipt(id);

    // MANAGER can only see their own receipts
    if (role === "MANAGER" && receipt.performedById !== session.user.id) {
      return apiForbidden();
    }

    // ADMIN can only see receipts in their modules
    if (role === "ADMIN") {
      const allowed = await canEditModule({ id: session.user.id, role }, receipt.moduleSlug ?? "inventory");
      if (!allowed) return apiForbidden();
    }

    return apiResponse(receipt);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "RECEIPT_NOT_FOUND") {
      return apiNotFound(error.message);
    }
    return apiServerError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { id } = await params;

    const body = await request.json();
    const parsed = editReceiptSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const receipt = await getReceipt(id).catch(() => null);
    if (!receipt) return apiNotFound("Приход не найден");

    const moduleSlug = receipt.moduleSlug ?? "inventory";

    // Route to correct or edit based on receipt status
    if (receipt.status === "CONFIRMED" || receipt.status === "CORRECTED") {
      // Only ADMIN or SUPERADMIN can correct confirmed receipts
      const allowed = await canCorrectReceipt({ id: session.user.id, role }, moduleSlug);
      if (!allowed) return apiForbidden();

      if (!parsed.data.items) {
        return apiError("ITEMS_REQUIRED", "Список позиций обязателен для коррекции подтверждённого прихода");
      }

      const result = await correctReceipt(
        id,
        {
          items: parsed.data.items,
          correctionReason: parsed.data.correctionReason,
        },
        session.user.id
      );

      await logAudit(session.user.id, "inventory.receipt.correct", "StockReceipt", id, {
        correctionId: result.correctionId,
        reason: parsed.data.correctionReason,
      });

      return apiResponse(result);
    } else {
      // DRAFT or PROBLEM: only ADMIN/SUPERADMIN can edit. MANAGER is read-only.
      if (role === "MANAGER") {
        return apiForbidden();
      }
      if (role === "ADMIN") {
        const allowed = await canEditModule({ id: session.user.id, role }, moduleSlug);
        if (!allowed) return apiForbidden();
      }

      const result = await editDraftReceipt(
        id,
        {
          supplierId: parsed.data.supplierId,
          invoiceNumber: parsed.data.invoiceNumber,
          receivedAt: parsed.data.receivedAt,
          notes: parsed.data.notes,
          items: parsed.data.items,
        },
        session.user.id
      );

      await logAudit(session.user.id, "inventory.receipt.edit", "StockReceipt", id, {
        updatedFields: Object.keys(parsed.data).filter((k) => parsed.data[k as keyof typeof parsed.data] !== undefined),
      });

      // Auto-confirm for ADMIN/SUPERADMIN after editing a DRAFT receipt so stock
      // updates immediately — consistent with the POST (create) handler behaviour.
      const canAutoConfirm = await canConfirmReceipt({ id: session.user.id, role }, moduleSlug);
      if (canAutoConfirm) {
        try {
          const confirmed = await confirmReceipt(id, session.user.id);
          await logAudit(session.user.id, "inventory.receipt.confirm", "StockReceipt", id, {
            batchIds: confirmed.batchIds,
            autoConfirmed: true,
          });
          return apiResponse({ ...result, status: confirmed.status, autoConfirmed: true });
        } catch (err) {
          if (err instanceof InventoryError) {
            return apiResponse({ ...result, autoConfirmed: false, confirmError: err.message });
          }
          throw err;
        }
      }

      return apiResponse({ ...result, autoConfirmed: false });
    }
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.code === "RECEIPT_NOT_FOUND") return apiNotFound(error.message);
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/inventory/receipts-v2/:id — hard delete a stock receipt (SUPERADMIN only)
 * Body: { password: string, reason?: string }
 *
 * Единственный HARD delete в системе: StockReceipt не имеет `deletedAt`,
 * StockMovement ссылается через строковый `referenceId` (без FK). Поэтому
 * в DeletionLog кладём полный снапшот (шапка + items + corrections) чтобы
 * при необходимости восстановить данные.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const authz = await authorizeSuperadminDeletion(request, session);
    if (!authz.ok) return authz.response;

    const { id } = await params;
    const receipt = await getReceipt(id).catch(() => null);
    if (!receipt) return apiNotFound("Приход не найден");

    const [items, corrections] = await Promise.all([
      prisma.stockReceiptItem.findMany({ where: { receiptId: id } }),
      prisma.stockReceiptCorrection.findMany({ where: { receiptId: id } }),
    ]);

    const affectedSkuIds = [...new Set(items.map((it) => it.skuId))];

    await prisma.$transaction(async (tx) => {
      // Collect all batch IDs that need to be removed.
      // Three sources:
      //   1. V1 legacy: batches linked via InventoryTransaction.receiptTxId
      //   2. V2 confirm: batches linked via StockReceiptItem.batchId
      //   3. V2 corrections: batches created for positive-delta corrections
      //      (correctReceipt recreates items without batchId, so they aren't
      //       captured by source 2 for CORRECTED receipts)

      const allBatchIds = new Set<string>();

      // --- Source 1: V1 ---
      // V1 legacy receipts: batches linked via InventoryTransaction → receiptTxId
      const receiptTx = await tx.inventoryTransaction.findFirst({
        where: { referenceId: id, type: "RECEIPT" },
        select: { id: true },
      });
      if (receiptTx) {
        const v1Batches = await tx.stockBatch.findMany({
          where: { receiptTxId: receiptTx.id },
          select: { id: true },
        });
        v1Batches.forEach((b) => allBatchIds.add(b.id));
        await tx.inventoryTransaction.delete({ where: { id: receiptTx.id } });
      }

      // V2 receipts: batches linked via StockReceiptItem.batchId
      const batchIds = items.map((it) => it.batchId).filter((bid): bid is string => bid != null);
      if (batchIds.length > 0) {
        // StockMovement.batchId → StockBatch is a real FK (NO ACTION).
        // Null it out before deleting batches to avoid constraint violation.
        await tx.stockMovement.updateMany({
          where: { batchId: { in: batchIds } },
          data: { batchId: null },
        });
        await tx.stockBatch.deleteMany({ where: { id: { in: batchIds } } });
      }

      await tx.stockReceiptItem.deleteMany({ where: { receiptId: id } });
      await tx.stockReceiptCorrection.deleteMany({ where: { receiptId: id } });
      await tx.stockReceipt.delete({ where: { id } });

      for (const skuId of affectedSkuIds) {
        await recalculateStock(tx, skuId);
      }
    });

    await logDeletion(authz, {
      entity: "StockReceipt",
      entityId: id,
      entityLabel: `Склад · приход ${receipt.invoiceNumber ?? id.slice(0, 8)} (${receipt.status})`,
      moduleSlug: receipt.moduleSlug ?? "inventory",
      deletionType: "HARD",
      snapshot: { receipt, items, corrections },
    });

    return apiResponse({ receiptId: id, deleted: true });
  } catch (error) {
    if (error instanceof InventoryError && error.code === "RECEIPT_NOT_FOUND") {
      return apiNotFound(error.message);
    }
    console.error("[DELETE receipt] Unexpected error:", error);
    void logEvent("ERROR", "inventory.receipt.delete", "Ошибка при удалении прихода", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return apiServerError();
  }
}
