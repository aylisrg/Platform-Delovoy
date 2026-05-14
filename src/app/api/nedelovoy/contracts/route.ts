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
import { listContracts, createContract, RentalError } from "@/modules/rental/service";
import { createContractSchema, contractFilterSchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const searchParams = request.nextUrl.searchParams;
    const params: Record<string, string | string[]> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key === "status" && params.status) {
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

    const result = await listContracts({ ...parsed.data, parkSlug: "nedelovoy" });
    return apiResponse(result.contracts, {
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
    const parsed = createContractSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const contract = await createContract({ ...parsed.data, parkSlug: "nedelovoy" });

    await logAudit(session!.user.id, "contract.create", "RentalContract", contract.id, {
      parkSlug: "nedelovoy",
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
