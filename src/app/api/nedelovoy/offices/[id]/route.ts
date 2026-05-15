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
import { getOffice, updateOffice, deleteOffice, RentalError } from "@/modules/rental/service";
import { logRentalChanges } from "@/modules/rental/changelog";
import { updateOfficeSchema } from "@/modules/rental/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const office = await getOffice(id);
    if (!office || office.parkSlug !== "nedelovoy") return apiNotFound("Помещение не найдено");
    return apiResponse(office);
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
    const parsed = updateOfficeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const before = await getOffice(id);
    if (!before || before.parkSlug !== "nedelovoy") return apiNotFound("Помещение не найдено");

    const office = await updateOffice(id, parsed.data);

    await logRentalChanges(
      session!.user.id,
      "Office",
      id,
      before as unknown as Record<string, unknown>,
      parsed.data as Record<string, unknown>,
      undefined,
      request.headers.get("x-forwarded-for") ?? undefined
    );

    await logAudit(session!.user.id, "office.update", "Office", id, parsed.data);

    return apiResponse(office);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const office = await getOffice(id);
    if (!office || office.parkSlug !== "nedelovoy") return apiNotFound("Помещение не найдено");

    await deleteOffice(id);

    await logAudit(session!.user.id, "office.delete", "Office", id);

    return apiResponse({ deleted: true });
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
