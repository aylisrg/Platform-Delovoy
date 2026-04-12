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
import { receiveStockByName, InventoryError } from "@/modules/inventory/service";
import { receiveSchema } from "@/modules/inventory/validation";

/**
 * POST /api/inventory/receive — receive stock (MANAGER, SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (
      session.user.role !== "SUPERADMIN" &&
      session.user.role !== "MANAGER"
    ) {
      return apiForbidden();
    }

    const body = await request.json();
    const parsed = receiveSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await receiveStockByName(
      parsed.data.name,
      parsed.data.quantity,
      parsed.data.note,
      session.user.id
    );

    await logAudit(
      session.user.id,
      "inventory.receive",
      "InventorySku",
      result.skuId,
      {
        name: parsed.data.name,
        quantity: parsed.data.quantity,
        note: parsed.data.note,
        newStockQuantity: result.newStockQuantity,
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
