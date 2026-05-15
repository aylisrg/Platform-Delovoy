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
import { getTenant, updateTenant, deleteTenant, RentalError } from "@/modules/rental/service";
import { logRentalChanges } from "@/modules/rental/changelog";
import { updateTenantSchema } from "@/modules/rental/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const tenant = await getTenant(id);
    if (!tenant) return apiNotFound("Арендатор не найден");
    return apiResponse(tenant);
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
    const parsed = updateTenantSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const before = await getTenant(id);
    if (!before) return apiNotFound("Арендатор не найден");

    const tenant = await updateTenant(id, parsed.data);

    await logRentalChanges(
      session!.user.id,
      "Tenant",
      id,
      before as unknown as Record<string, unknown>,
      parsed.data as Record<string, unknown>,
      undefined,
      request.headers.get("x-forwarded-for") ?? undefined
    );

    await logAudit(session!.user.id, "tenant.update", "Tenant", id, parsed.data);

    return apiResponse(tenant);
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
    await deleteTenant(id);

    await logRentalChanges(
      session!.user.id,
      "Tenant",
      id,
      { isDeleted: false },
      { isDeleted: true },
      "Soft delete"
    );

    await logAudit(session!.user.id, "tenant.delete", "Tenant", id);

    return apiResponse({ deleted: true });
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
