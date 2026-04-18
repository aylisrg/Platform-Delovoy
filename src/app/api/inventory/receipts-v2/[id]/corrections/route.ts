import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiNotFound,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { canConfirmReceipt } from "@/lib/permissions";
import { getReceipt, getReceiptCorrections, InventoryError } from "@/modules/inventory/service-v2";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN") return apiForbidden();

    const { id } = await params;

    const receipt = await getReceipt(id).catch(() => null);
    if (!receipt) return apiNotFound("Приход не найден");

    const allowed = await canConfirmReceipt(
      { id: session.user.id, role },
      receipt.moduleSlug ?? "cafe"
    );
    if (!allowed) return apiForbidden();

    const corrections = await getReceiptCorrections(id);
    return apiResponse(corrections);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "RECEIPT_NOT_FOUND") {
      return apiNotFound(error.message);
    }
    return apiServerError();
  }
}
