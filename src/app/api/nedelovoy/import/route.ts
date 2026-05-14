import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { importFromJson } from "@/modules/rental/service";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const body = await request.json();

    if (!body.tenants || !body.offices || !body.contracts) {
      return apiError(
        "INVALID_IMPORT_DATA",
        "JSON должен содержать поля: tenants, offices, contracts"
      );
    }

    const result = await importFromJson(body);

    await logAudit(session!.user.id, "rental.import", "RentalContract", undefined, {
      parkSlug: "nedelovoy",
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
