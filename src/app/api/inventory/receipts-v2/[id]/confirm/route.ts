import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiNotFound,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { canConfirmReceipt } from "@/lib/permissions";
import { confirmReceipt, getReceipt, InventoryError } from "@/modules/inventory/service-v2";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN") return apiForbidden();

    const { id } = await params;

    // Load receipt to check module access
    const receipt = await getReceipt(id).catch(() => null);
    if (!receipt) return apiNotFound("Приход не найден");

    const allowed = await canConfirmReceipt(
      { id: session.user.id, role },
      receipt.moduleSlug ?? "cafe"
    );
    if (!allowed) return apiForbidden();

    const result = await confirmReceipt(id, session.user.id);

    await logAudit(session.user.id, "inventory.receipt.confirm", "StockReceipt", id, {
      batchIds: result.batchIds,
    });

    return apiResponse(result);
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.code === "RECEIPT_NOT_FOUND") return apiNotFound(error.message);
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
