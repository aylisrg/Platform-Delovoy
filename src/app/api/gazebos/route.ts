import { NextRequest } from "next/server";
import { apiResponse, apiServerError, apiUnauthorized, apiForbidden, apiValidationError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { canEditModule } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { listResources, createResource } from "@/modules/gazebos/service";
import { createResourceSchema } from "@/modules/gazebos/validation";

/**
 * GET /api/gazebos — list all active gazebo resources
 */
export async function GET(request: NextRequest) {
  try {
    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const resources = await listResources(!showAll);
    return apiResponse(resources);
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/gazebos — create a new gazebo resource (admin, issue #667).
 * Middleware treats this exact path as a public GET route (#527 allowlist) —
 * POST is not covered by that bypass and needs its own auth+RBAC check here,
 * same as PATCH /api/gazebos/:id.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!(await canEditModule(session.user, "gazebos"))) return apiForbidden();

    const body = await request.json();
    const parsed = createResourceSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const resource = await createResource(parsed.data);

    await logAudit(session.user.id, "gazebos.resource.create", "Resource", resource.id, {
      moduleSlug: "gazebos",
      name: parsed.data.name,
      capacity: parsed.data.capacity,
      pricePerHour: parsed.data.pricePerHour,
    });

    return apiResponse(resource, undefined, 201);
  } catch {
    return apiServerError();
  }
}
