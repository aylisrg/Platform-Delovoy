import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { importFromJson } from "@/modules/rental/service";

/**
 * POST /api/rental/import — import data from JSON (SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const body = await request.json();

    if (!body.tenants || !body.offices || !body.contracts) {
      return apiError("INVALID_IMPORT_DATA", "JSON должен содержать поля: tenants, offices, contracts");
    }

    const result = await importFromJson(body);

    await logAudit(session.user.id, "rental.import", "RentalContract", undefined, {
      tenants: result.tenants,
      offices: result.offices,
      contracts: result.contracts,
      errors: result.errors.length,
    });

    return apiResponse(result, undefined, 201);
  } catch {
    return apiServerError();
  }
}
