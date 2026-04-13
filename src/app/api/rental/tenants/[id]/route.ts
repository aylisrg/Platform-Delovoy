import { NextRequest } from "next/server";
import { apiResponse, apiError, apiNotFound, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getTenant, updateTenant, deleteTenant, RentalError } from "@/modules/rental/service";
import { logRentalChanges } from "@/modules/rental/changelog";
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
 * PUT /api/rental/tenants/:id — update any tenant field (MANAGER/SUPERADMIN)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Get current state for diff
    const before = await getTenant(id);
    if (!before) return apiNotFound("Арендатор не найден");

    const tenant = await updateTenant(id, parsed.data);

    // Log field-level changes
    await logRentalChanges(
      session.user.id,
      "Tenant",
      id,
      before as unknown as Record<string, unknown>,
      parsed.data as Record<string, unknown>,
      undefined,
      request.headers.get("x-forwarded-for") ?? undefined
    );

    await logAudit(session.user.id, "tenant.update", "Tenant", id, parsed.data);

    return apiResponse(tenant);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}

/**
 * DELETE /api/rental/tenants/:id — soft delete tenant (SUPERADMIN)
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { id } = await params;
    await deleteTenant(id);

    await logRentalChanges(
      session.user.id,
      "Tenant",
      id,
      { isDeleted: false },
      { isDeleted: true },
      "Soft delete"
    );

    await logAudit(session.user.id, "tenant.delete", "Tenant", id);

    return apiResponse({ deleted: true });
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
