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
import { finalizeAudit, InventoryError } from "@/modules/inventory/service-v2";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const audit = await finalizeAudit(id, session.user.id);

    await logAudit(session.user.id, "inventory.audit.complete", "InventoryAudit", id, {
      adjustedItems: audit.counts.filter((c) => c.delta !== 0).length,
    });

    return apiResponse(audit);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "AUDIT_NOT_FOUND") return apiNotFound(error.message);
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
