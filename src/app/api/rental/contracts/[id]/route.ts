import { NextRequest } from "next/server";
import { apiResponse, apiError, apiNotFound, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getContract, updateContract, RentalError } from "@/modules/rental/service";
import { updateContractSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/contracts/:id — get contract (MANAGER/SUPERADMIN)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const contract = await getContract(id);
    if (!contract) return apiNotFound("Договор не найден");
    return apiResponse(contract);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/rental/contracts/:id — update contract status/data (MANAGER/SUPERADMIN)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateContractSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const contract = await updateContract(id, parsed.data);

    await logAudit(session.user.id, "contract.update", "RentalContract", id, parsed.data);

    return apiResponse(contract);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
