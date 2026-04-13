import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listContracts, createContract, RentalError } from "@/modules/rental/service";
import { createContractSchema, contractFilterSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/contracts — list contracts with filters and pagination (MANAGER/SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const searchParams = request.nextUrl.searchParams;
    const params: Record<string, string | string[]> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key === "status" && params.status) {
        // Support multiple status params: ?status=ACTIVE&status=EXPIRING
        if (Array.isArray(params.status)) {
          (params.status as string[]).push(value);
        } else {
          params.status = [params.status as string, value];
        }
      } else {
        params[key] = value;
      }
    }

    const parsed = contractFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await listContracts(parsed.data);
    return apiResponse(result.contracts, { page: result.page, perPage: result.limit, total: result.total });
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/rental/contracts — create contract (MANAGER/SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const body = await request.json();
    const parsed = createContractSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const contract = await createContract(parsed.data);

    await logAudit(session.user.id, "contract.create", "RentalContract", contract.id, {
      tenantId: parsed.data.tenantId,
      officeId: parsed.data.officeId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });

    return apiResponse(contract, undefined, 201);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
