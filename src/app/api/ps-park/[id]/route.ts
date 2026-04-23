import { NextRequest } from "next/server";
import { apiResponse, apiNotFound, apiServerError, apiValidationError, apiUnauthorized, apiForbidden } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { canEditModule } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { prisma } from "@/lib/db";
import { getTable, updateTable } from "@/modules/ps-park/service";
import { updateTableSchema } from "@/modules/ps-park/validation";

/**
 * GET /api/ps-park/:id — get single table
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resource = await getTable(id);
    if (!resource) return apiNotFound("Стол не найден");
    return apiResponse(resource);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/ps-park/:id — update table (admin)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!(await canEditModule(session.user, "ps-park"))) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateTableSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await getTable(id);
    if (!existing) return apiNotFound("Стол не найден");

    const updated = await updateTable(id, parsed.data);

    await logAudit(
      session.user.id,
      "ps-park.resource.update",
      "Resource",
      id,
      {
        moduleSlug: "ps-park",
        changes: parsed.data,
        before: {
          name: existing.name,
          capacity: existing.capacity,
          pricePerHour: existing.pricePerHour,
          isActive: existing.isActive,
        },
      }
    );

    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}

/**
 * DELETE /api/ps-park/:id — soft delete a PS Park table (SUPERADMIN only)
 * Body: { password: string, reason?: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const authz = await authorizeSuperadminDeletion(request, session);
    if (!authz.ok) return authz.response;

    const { id } = await params;
    const resource = await getTable(id);
    if (!resource) return apiNotFound("Стол не найден");

    await prisma.resource.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await logDeletion(authz, {
      entity: "Resource",
      entityId: id,
      entityLabel: `PS Park · ${resource.name}`,
      moduleSlug: "ps-park",
      snapshot: resource,
    });
    return apiResponse({ id, deletedAt: new Date().toISOString() });
  } catch {
    return apiServerError();
  }
}
