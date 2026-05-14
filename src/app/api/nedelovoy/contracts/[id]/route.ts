import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getContract, updateContract, RentalError } from "@/modules/rental/service";
import { logRentalChanges } from "@/modules/rental/changelog";
import { updateContractSchema } from "@/modules/rental/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const contract = await getContract(id);
    if (!contract) return apiNotFound("Договор не найден");
    return apiResponse(contract);
  } catch {
    return apiServerError();
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateContractSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const before = await getContract(id);
    if (!before) return apiNotFound("Договор не найден");

    const contract = await updateContract(id, parsed.data);

    await logRentalChanges(
      session!.user.id,
      "RentalContract",
      id,
      before as unknown as Record<string, unknown>,
      parsed.data as Record<string, unknown>,
      undefined,
      request.headers.get("x-forwarded-for") ?? undefined
    );

    await logAudit(session!.user.id, "contract.update", "RentalContract", id, parsed.data);

    return apiResponse(contract);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
