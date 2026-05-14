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
import { listOffices, createOffice, RentalError } from "@/modules/rental/service";
import { createOfficeSchema, officeFilterSchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = officeFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }
    const offices = await listOffices({ ...parsed.data, parkSlug: "nedelovoy" });
    return apiResponse(offices);
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
    const parsed = createOfficeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const office = await createOffice({ ...parsed.data, parkSlug: "nedelovoy" });

    await logAudit(session!.user.id, "office.create", "Office", office.id, {
      parkSlug: "nedelovoy",
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
