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
import { listAudits, createAudit, InventoryError } from "@/modules/inventory/service-v2";
import { createAuditSchema } from "@/modules/inventory/validation";

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const audits = await listAudits();
    return apiResponse(audits, { total: audits.length });
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const body = await request.json();
    const parsed = createAuditSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const audit = await createAudit(parsed.data, session.user.id);

    await logAudit(session.user.id, "inventory.audit.start", "InventoryAudit", audit.id, {
      notes: parsed.data.notes,
    });

    return apiResponse(audit, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
