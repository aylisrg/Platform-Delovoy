import { NextRequest } from "next/server";
import { apiResponse, apiNotFound, apiServerError, apiValidationError, apiUnauthorized, apiForbidden } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
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
    if (!session?.user) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateTableSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    // Only SUPERADMIN can change pricePerHour
    if (parsed.data.pricePerHour !== undefined && session.user.role !== "SUPERADMIN") {
      return apiForbidden("Изменение цены доступно только администратору");
    }

    const existing = await getTable(id);
    if (!existing) return apiNotFound("Стол не найден");

    const updated = await updateTable(id, parsed.data);

    if (parsed.data.pricePerHour !== undefined) {
      await logAudit(session.user.id!, "resource.price.update", "Resource", id, {
        before: existing.pricePerHour,
        after: parsed.data.pricePerHour,
      });
    }

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
