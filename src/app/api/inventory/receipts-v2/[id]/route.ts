import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiNotFound,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getReceipt, InventoryError } from "@/modules/inventory/service-v2";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const receipt = await getReceipt(id);
    return apiResponse(receipt);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "RECEIPT_NOT_FOUND") return apiNotFound(error.message);
    return apiServerError();
  }
}
