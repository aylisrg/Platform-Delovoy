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
import { mergeSku, InventoryError } from "@/modules/inventory/service";
import { mergeSkuSchema } from "@/modules/inventory/validation";

/**
 * POST /api/inventory/sku/:id/merge
 * Merges source SKU (:id) into targetSkuId.
 * Moves all stock, movements, receipts, write-offs and audit counts to target,
 * then archives the source. SUPERADMIN only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "ADMIN") return apiForbidden();

    const { id: sourceId } = await params;

    const body = await request.json();
    const parsed = mergeSkuSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await mergeSku(sourceId, parsed.data.targetSkuId, session.user.id);

    await logAudit(session.user.id, "inventory.sku.merge", "InventorySku", sourceId, {
      targetSkuId: parsed.data.targetSkuId,
      targetSkuName: result.targetName,
      newStockQuantity: result.newStockQuantity,
    });

    return apiResponse(result);
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.code === "SKU_NOT_FOUND") return apiNotFound(error.message);
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
