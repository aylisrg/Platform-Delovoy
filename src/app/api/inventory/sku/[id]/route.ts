import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { getSku, updateSku, archiveSku, InventoryError } from "@/modules/inventory/service";
import { updateSkuSchema } from "@/modules/inventory/validation";

/**
 * PATCH /api/inventory/sku/:id — update SKU (SUPERADMIN or ADMIN)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN") return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateSkuSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await getSku(id);
    if (!existing) return apiNotFound("Товар не найден");

    const priceChanged =
      parsed.data.price !== undefined &&
      Number(existing.price) !== parsed.data.price;

    const updated = await updateSku(id, parsed.data);

    await logAudit(session.user.id, "inventory.sku.update", "InventorySku", id, {
      changes: parsed.data,
      ...(priceChanged && {
        priceChange: { before: existing.price, after: parsed.data.price },
      }),
    });

    return apiResponse(updated);
  } catch (error) {
    if (error instanceof InventoryError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/inventory/sku/:id — archive (soft delete) SKU (SUPERADMIN only)
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
    const existing = await getSku(id);
    if (!existing) return apiNotFound("Товар не найден");

    const result = await archiveSku(id);

    await logDeletion(authz, {
      entity: "InventorySku",
      entityId: id,
      entityLabel: `Склад · ${existing.name}`,
      moduleSlug: "inventory",
      snapshot: existing,
    });

    return apiResponse(result);
  } catch (error) {
    if (error instanceof InventoryError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
