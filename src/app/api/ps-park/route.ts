import { NextRequest } from "next/server";
import { apiResponse, apiServerError, apiUnauthorized, apiForbidden, apiValidationError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { canEditModule } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { listTables, createTable } from "@/modules/ps-park/service";
import { createTableSchema } from "@/modules/ps-park/validation";

/**
 * GET /api/ps-park — list all active Плей Парк tables
 */
export async function GET(request: NextRequest) {
  try {
    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const resources = await listTables(!showAll);
    return apiResponse(resources);
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/ps-park — create a new Плей Парк table (admin, issue #667).
 * Middleware treats this exact path as a public GET route (#527 allowlist) —
 * POST is not covered by that bypass and needs its own auth+RBAC check here,
 * same as PATCH /api/ps-park/:id.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!(await canEditModule(session.user, "ps-park"))) return apiForbidden();

    const body = await request.json();
    const parsed = createTableSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const table = await createTable(parsed.data);

    await logAudit(session.user.id, "ps-park.resource.create", "Resource", table.id, {
      moduleSlug: "ps-park",
      name: parsed.data.name,
      capacity: parsed.data.capacity,
      pricePerHour: parsed.data.pricePerHour,
    });

    return apiResponse(table, undefined, 201);
  } catch {
    return apiServerError();
  }
}
