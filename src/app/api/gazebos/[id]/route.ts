import { NextRequest } from "next/server";
import { apiResponse, apiNotFound, apiServerError, apiValidationError, apiUnauthorized, apiForbidden } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { canEditModule } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { authorizeSuperadminDeletion, logDeletion } from "@/lib/deletion";
import { prisma } from "@/lib/db";
import { getResource, updateResource } from "@/modules/gazebos/service";
import { updateResourceSchema } from "@/modules/gazebos/validation";

/**
 * GET /api/gazebos/:id — get single resource
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resource = await getResource(id);
    if (!resource) return apiNotFound("Беседка не найдена");
    return apiResponse(resource);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/gazebos/:id — update resource (admin)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!(await canEditModule(session.user, "gazebos"))) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateResourceSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await getResource(id);
    if (!existing) return apiNotFound("Беседка не найдена");

    const updated = await updateResource(id, parsed.data);

    await logAudit(
      session.user.id,
      "gazebos.resource.update",
      "Resource",
      id,
      {
        moduleSlug: "gazebos",
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
 * DELETE /api/gazebos/:id — soft delete a gazebo resource (SUPERADMIN only)
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
    const resource = await getResource(id);
    if (!resource) return apiNotFound("Беседка не найдена");

    await prisma.resource.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await logDeletion(authz, {
      entity: "Resource",
      entityId: id,
      entityLabel: `Беседка · ${resource.name}`,
      moduleSlug: "gazebos",
      snapshot: resource,
    });
    return apiResponse({ id, deletedAt: new Date().toISOString() });
  } catch {
    return apiServerError();
  }
}
