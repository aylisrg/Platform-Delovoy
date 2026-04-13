import { NextRequest } from "next/server";
import { apiResponse, apiError, apiUnauthorized, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listOffices, createOffice, RentalError } from "@/modules/rental/service";
import { createOfficeSchema, officeFilterSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/offices — list offices with filters (MANAGER/SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!["MANAGER", "SUPERADMIN"].includes(session.user.role ?? "")) return apiForbidden();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = officeFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }
    const offices = await listOffices(parsed.data);
    return apiResponse(offices);
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/rental/offices — create office (SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const body = await request.json();
    const parsed = createOfficeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const office = await createOffice(parsed.data);

    await logAudit(session.user.id, "office.create", "Office", office.id, {
      number: parsed.data.number,
      building: parsed.data.building,
      floor: parsed.data.floor,
    });

    return apiResponse(office, undefined, 201);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
