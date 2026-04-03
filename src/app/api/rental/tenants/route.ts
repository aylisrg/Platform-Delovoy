import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listTenants, createTenant, RentalError } from "@/modules/rental/service";
import { createTenantSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/tenants — list tenants (MANAGER/SUPERADMIN)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const tenants = await listTenants();
    return apiResponse(tenants);
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/rental/tenants — create tenant (MANAGER/SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const body = await request.json();
    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const tenant = await createTenant(parsed.data);

    await logAudit(session.user.id, "tenant.create", "Tenant", tenant.id, {
      companyName: parsed.data.companyName,
    });

    return apiResponse(tenant, undefined, 201);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
