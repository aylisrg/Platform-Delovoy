import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listContracts, createContract, RentalError } from "@/modules/rental/service";
import { createContractSchema, contractFilterSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/contracts — list contracts (MANAGER/SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = contractFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const contracts = await listContracts(parsed.data);
    return apiResponse(contracts);
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
    const deniedPost = await requireAdminSection(session, "rental");
    if (deniedPost) return deniedPost;

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
