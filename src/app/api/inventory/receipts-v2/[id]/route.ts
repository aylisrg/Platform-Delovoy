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
import { logAudit } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { canCorrectReceipt, hasModuleAccess } from "@/lib/permissions";
import {
  getReceipt,
  editDraftReceipt,
  correctReceipt,
  InventoryError,
} from "@/modules/inventory/service-v2";
import { editReceiptSchema } from "@/modules/inventory/validation";

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
      const allowed = await hasModuleAccess(session.user.id, receipt.moduleSlug ?? "cafe");
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

    const moduleSlug = receipt.moduleSlug ?? "cafe";

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
        const allowed = await hasModuleAccess(session.user.id, moduleSlug);
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

      return apiResponse(result);
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

    await prisma.stockReceiptItem.deleteMany({ where: { receiptId: id } });
    await prisma.stockReceiptCorrection.deleteMany({ where: { receiptId: id } });
    await prisma.stockReceipt.delete({ where: { id } });

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
    return apiServerError();
  }
}
