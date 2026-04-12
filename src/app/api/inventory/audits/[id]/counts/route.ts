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
import { submitAuditCounts, InventoryError } from "@/modules/inventory/service-v2";
import { auditCountsSchema } from "@/modules/inventory/validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = auditCountsSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const audit = await submitAuditCounts(id, parsed.data.counts, session.user.id);

    await logAudit(session.user.id, "inventory.audit.counts", "InventoryAudit", id, {
      countItems: parsed.data.counts.length,
    });

    return apiResponse(audit);
  } catch (error) {
    if (error instanceof InventoryError && error.code === "AUDIT_NOT_FOUND") return apiNotFound(error.message);
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
