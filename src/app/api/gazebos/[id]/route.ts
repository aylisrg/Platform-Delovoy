import { NextRequest } from "next/server";
import { apiResponse, apiNotFound, apiServerError, apiValidationError, apiUnauthorized, apiForbidden } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
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
    if (!session?.user) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateResourceSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await getResource(id);
    if (!existing) return apiNotFound("Беседка не найдена");

    const updated = await updateResource(id, parsed.data);
    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
