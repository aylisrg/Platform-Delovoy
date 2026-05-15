import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listTenants, createTenant, RentalError } from "@/modules/rental/service";
import { createTenantSchema, tenantFilterSchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = tenantFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await listTenants(parsed.data);
    return apiResponse(result.tenants, {
      page: result.page,
      perPage: result.limit,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const body = await request.json();
    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const tenant = await createTenant(parsed.data);

    await logAudit(session!.user.id, "tenant.create", "Tenant", tenant.id, {
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
