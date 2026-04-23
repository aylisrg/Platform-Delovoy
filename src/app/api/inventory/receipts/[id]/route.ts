import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { hasModuleAccess } from "@/lib/permissions";
import { updateReceipt, deleteReceipt } from "@/modules/inventory/stock";
import { InventoryError } from "@/modules/inventory/errors";
import { updateReceiptSchema } from "@/modules/inventory/validation";

const INVENTORY_MODULE_SLUGS = ["cafe", "bbq", "ps-park"] as const;

async function managerHasInventoryAccess(userId: string): Promise<boolean> {
  for (const slug of INVENTORY_MODULE_SLUGS) {
    if (await hasModuleAccess(userId, slug)) return true;
  }
  return false;
}

/**
 * PATCH /api/inventory/receipts/:id — edit a legacy RECEIPT/INITIAL transaction.
 * Body: { quantity?, receivedAt? (YYYY-MM-DD), note? }
 *
 * Roles:
 *  - SUPERADMIN / ADMIN: always allowed
 *  - MANAGER: requires module access on at least one inventory module
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") {
      return apiForbidden();
    }
    if (role === "MANAGER") {
      const allowed = await managerHasInventoryAccess(session.user.id);
      if (!allowed) return apiForbidden();
    }

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== "object") {
      return apiValidationError("Некорректное тело запроса");
    }
    const parsed = updateReceiptSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const receivedAt = parsed.data.receivedAt
      ? new Date(`${parsed.data.receivedAt}T00:00:00.000Z`)
      : undefined;

    const result = await updateReceipt(
      id,
      {
        quantity: parsed.data.quantity,
        receivedAt,
        note: parsed.data.note,
      },
      session.user.id
    );

    await logAudit(
      session.user.id,
      "inventory.receipt.update",
      "InventoryTransaction",
      id,
      {
        quantity: parsed.data.quantity,
        receivedAt: parsed.data.receivedAt,
        note: parsed.data.note,
        delta: result.delta,
        newStockQuantity: result.newStockQuantity,
      }
    );

    return apiResponse(result);
  } catch (err) {
    if (err instanceof InventoryError) {
      if (err.code === "RECEIPT_NOT_FOUND") return apiNotFound(err.message);
      if (err.code === "RECEIPT_PARTIALLY_SOLD") {
        return apiError(err.code, err.message, 409);
      }
      return apiError(err.code, err.message, 422);
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/inventory/receipts/:id — hard delete a legacy receipt transaction.
 * SUPERADMIN only; requires password re-auth via authorizeSuperadminDeletion.
 * Body: { password: string, reason?: string }
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

    const existing = await prisma.inventoryTransaction.findUnique({
      where: { id },
      include: { sku: { select: { name: true } } },
    });
    if (!existing) return apiNotFound("Приход не найден");

    const result = await deleteReceipt(id, authz.actor.id, {
      reason: authz.reason ?? undefined,
    });

    await logDeletion(authz, {
      entity: "InventoryTransaction",
      entityId: id,
      entityLabel: `Склад · приход ${existing.sku.name} x${existing.quantity}`,
      moduleSlug: existing.moduleSlug ?? "inventory",
      deletionType: "HARD",
      snapshot: { transaction: existing, newStockQuantity: result.newStockQuantity },
    });

    return apiResponse({ receiptId: id, deleted: true, newStockQuantity: result.newStockQuantity });
  } catch (err) {
    if (err instanceof InventoryError) {
      if (err.code === "RECEIPT_NOT_FOUND") return apiNotFound(err.message);
      if (err.code === "RECEIPT_PARTIALLY_SOLD") {
        return apiError(err.code, err.message, 409);
      }
      return apiError(err.code, err.message, 422);
    }
    return apiServerError();
  }
}
