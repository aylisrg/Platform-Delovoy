import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getTenantContracts, RentalError } from "@/modules/rental/service";

/**
 * GET /api/rental/tenants/:id/contracts — all contracts for a tenant (MANAGER/SUPERADMIN)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const contracts = await getTenantContracts(id);
    return apiResponse(contracts);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
