import { NextRequest } from "next/server";
import { apiResponse, apiError, apiNotFound, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getOffice, updateOffice, RentalError } from "@/modules/rental/service";
import { updateOfficeSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/:id — get office by ID
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const office = await getOffice(id);
    if (!office) return apiNotFound("Офис не найден");
    return apiResponse(office);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/rental/:id — update office (MANAGER/SUPERADMIN)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateOfficeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const office = await updateOffice(id, parsed.data);

    await logAudit(session.user.id, "office.update", "Office", id, parsed.data);

    return apiResponse(office);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
