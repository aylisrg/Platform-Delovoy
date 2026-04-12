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
import { voidTransaction, InventoryError } from "@/modules/inventory/service";
import { voidTransactionSchema } from "@/modules/inventory/validation";

/**
 * DELETE /api/inventory/transactions/:id — void transaction (SUPERADMIN)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { id } = await params;

    let note: string | undefined;
    try {
      const body = await request.json();
      const parsed = voidTransactionSchema.safeParse(body);
      if (!parsed.success) {
        return apiValidationError(parsed.error.issues[0].message);
      }
      note = parsed.data.note;
    } catch {
      // Body is optional
    }

    const result = await voidTransaction(id, session.user.id, note);

    await logAudit(
      session.user.id,
      "inventory.transaction.void",
      "InventoryTransaction",
      id,
      { note }
    );

    return apiResponse(result);
  } catch (error) {
    if (error instanceof InventoryError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
