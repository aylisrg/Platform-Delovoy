import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { terminateContract, RentalError } from "@/modules/rental/service";

/**
 * POST /api/rental/contracts/:id/terminate — terminate contract (SUPERADMIN)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { id } = await params;
    let reason: string | undefined;
    try {
      const body = await request.json();
      reason = body.reason;
    } catch {
      // No body is fine
    }

    const contract = await terminateContract(id, reason);

    await logAudit(session.user.id, "contract.terminate", "RentalContract", id, { reason });

    return apiResponse(contract);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
