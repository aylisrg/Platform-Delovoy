import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
  apiNotFound,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import {
  getSupplier,
  updateSupplier,
  deleteSupplier,
  InventoryError,
} from "@/modules/inventory/service-v2";
import { updateSupplierSchema } from "@/modules/inventory/validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const supplier = await getSupplier(id);
    return apiResponse(supplier);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "SUPPLIER_NOT_FOUND") return apiNotFound(error.message);
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
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateSupplierSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const supplier = await updateSupplier(id, parsed.data);

    await logAudit(session.user.id, "inventory.supplier.update", "Supplier", id, parsed.data);

    return apiResponse(supplier);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "SUPPLIER_NOT_FOUND") return apiNotFound(error.message);
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const result = await deleteSupplier(id);

    await logAudit(session.user.id, "inventory.supplier.delete", "Supplier", id);

    return apiResponse(result);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "SUPPLIER_NOT_FOUND") return apiNotFound(error.message);
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
