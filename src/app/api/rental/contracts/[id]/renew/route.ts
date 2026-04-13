import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { renewContract, RentalError } from "@/modules/rental/service";
import { renewContractSchema } from "@/modules/rental/validation";

/**
 * POST /api/rental/contracts/:id/renew — renew contract (MANAGER/SUPERADMIN)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = renewContractSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const contract = await renewContract(id, parsed.data);

    await logAudit(session.user.id, "contract.renew", "RentalContract", id, parsed.data);

    return apiResponse(contract);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
