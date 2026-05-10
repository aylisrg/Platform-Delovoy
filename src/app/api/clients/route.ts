import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  hasRole,
  hasAdminSectionAccess,
  getUserAdminSections,
} from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { listClients, createClient, ClientError } from "@/modules/clients/service";
import {
  clientFilterSchema,
  createClientSchema,
} from "@/modules/clients/validation";

/**
 * GET /api/clients — list of guest cards (USER role) with search & pagination.
 * F4 ADR — MANAGER+ access (CRM is a cross-cutting section, see ADR §8).
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Требуется роль менеджера");
    }

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = clientFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    // F8 RBAC: a manager without explicit `clients` grant must be filtered
    // to *one of their own* module sections. If they didn't request a
    // moduleSlug, server-side restrict to whatever modules they have admin
    // access to. If they requested a moduleSlug they don't have access
    // to — 403. SUPERADMIN/`clients`-grant users see everything.
    const hasGlobalGrant = await hasAdminSectionAccess(session.user.id, "clients");
    let effectiveFilter = parsed.data;
    if (!hasGlobalGrant) {
      const sections = await getUserAdminSections(session.user.id);
      const accessibleModuleSections = sections.filter((s) =>
        ["gazebos", "ps-park", "cafe"].includes(s)
      );
      if (accessibleModuleSections.length === 0) {
        return apiForbidden("Нет доступа к гостям");
      }
      if (parsed.data.moduleSlug) {
        if (!accessibleModuleSections.includes(parsed.data.moduleSlug)) {
          return apiForbidden("Нет доступа к этому модулю");
        }
        effectiveFilter = parsed.data;
      } else if (accessibleModuleSections.length === 1) {
        // Auto-narrow: single-module manager sees only their own. The
        // section list was already filtered to clientFilterSchema's enum,
        // so this cast is safe.
        effectiveFilter = {
          ...parsed.data,
          moduleSlug: accessibleModuleSections[0] as "gazebos" | "ps-park" | "cafe",
        };
      } else {
        // Multi-module manager without clients grant: union not supported
        // by listClients today — require them to pick one explicitly.
        return apiValidationError(
          "Укажите параметр moduleSlug — у вас доступ к нескольким модулям"
        );
      }
    }

    const { clients, total } = await listClients(effectiveFilter);
    return apiResponse(
      { clients, total },
      {
        total,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      }
    );
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/clients — manually create a guest card.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Требуется роль менеджера");
    }

    const body = await request.json();
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { id } = await createClient(parsed.data, session.user.id);
    return apiResponse({ id }, undefined, 201);
  } catch (error) {
    if (error instanceof ClientError) {
      const status =
        error.code === "CLIENT_PHONE_DUPLICATE"
          ? 409
          : error.code === "INVALID_PHONE"
            ? 422
            : 400;
      return apiError(error.code, error.message, status, error.metadata);
    }
    return apiServerError();
  }
}
