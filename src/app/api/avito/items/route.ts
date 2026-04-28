import { NextRequest } from "next/server";
import {
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess, getUserModules } from "@/lib/permissions";
import { listAvitoItems } from "@/lib/avito";
import { AvitoItemsQuerySchema } from "@/lib/avito/validation";
import { itemsToDto } from "./_dto";

export const dynamic = "force-dynamic";

/**
 * GET /api/avito/items — list Avito items with primary period snapshot.
 * RBAC:
 *  - SUPERADMIN: all items.
 *  - ADMIN/MANAGER with `avito` section permission: items in their assigned modules.
 *  - Otherwise: 403.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const role = session.user.role;
    const isSuper = role === "SUPERADMIN";
    if (!isSuper) {
      const allowed = await hasAdminSectionAccess(session.user.id, "avito");
      if (!allowed) return apiForbidden("Нет доступа к разделу Деловой Авито");
    }

    const parsed = AvitoItemsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) return apiValidationError(parsed.error.issues[0]?.message ?? "invalid query");

    let moduleSlugFilter: string | null | undefined;
    if (parsed.data.moduleSlug === undefined || parsed.data.moduleSlug === "all") {
      moduleSlugFilter = undefined;
    } else if (parsed.data.moduleSlug === "none") {
      moduleSlugFilter = null;
    } else {
      moduleSlugFilter = parsed.data.moduleSlug;
    }

    const items = await listAvitoItems({ moduleSlug: moduleSlugFilter, period: parsed.data.period });

    // Manager filter: only items in modules they're assigned to.
    let visibleItems = items;
    if (!isSuper) {
      const myModules = new Set(await getUserModules(session.user.id));
      visibleItems = items.filter((it) => !it.moduleSlug || myModules.has(it.moduleSlug));
    }

    return apiResponse({ items: itemsToDto(visibleItems, parsed.data.period) });
  } catch (err) {
    console.error("[GET /api/avito/items] error", err);
    return apiServerError();
  }
}
