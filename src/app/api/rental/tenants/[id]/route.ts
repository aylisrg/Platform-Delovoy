import { NextRequest } from "next/server";
import { apiResponse, apiError, apiNotFound, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getTenant, updateTenant, RentalError } from "@/modules/rental/service";
import { updateTenantSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/tenants/:id — get tenant with contract history (MANAGER/SUPERADMIN)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const tenant = await getTenant(id);
    if (!tenant) return apiNotFound("Арендатор не найден");
    return apiResponse(tenant);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/rental/tenants/:id — update tenant (MANAGER/SUPERADMIN)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateTenantSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const tenant = await updateTenant(id, parsed.data);

    await logAudit(session.user.id, "tenant.update", "Tenant", id, parsed.data);

    return apiResponse(tenant);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
