import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { adjustStock, InventoryError } from "@/modules/inventory/service";
import { adjustSchema } from "@/modules/inventory/validation";

/**
 * POST /api/inventory/adjust — adjust stock quantity (SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const body = await request.json();
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await adjustStock(parsed.data, session.user.id);

    await logAudit(
      session.user.id,
      "inventory.adjust",
      "InventoryTransaction",
      result.transactionId,
      {
        skuId: parsed.data.skuId,
        targetQuantity: parsed.data.targetQuantity,
        delta: result.delta,
        note: parsed.data.note,
      }
    );

    return apiResponse(result, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
