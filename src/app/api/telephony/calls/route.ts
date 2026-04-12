import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { listCalls } from "@/modules/telephony/service";
import { callFilterSchema } from "@/modules/telephony/validation";

/**
 * GET /api/telephony/calls — list call logs with filtering
 * RBAC: SUPERADMIN (all), MANAGER (own moduleSlug only)
 * Query params: bookingId?, moduleSlug?, status?, dateFrom?, dateTo?, page?, perPage?
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { searchParams } = request.nextUrl;
    const rawFilter = Object.fromEntries(searchParams.entries());

    const parsed = callFilterSchema.safeParse(rawFilter);
    if (!parsed.success) {
      const filter = callFilterSchema.parse({});
      const result = await listCalls(filter);
      return apiResponse(result.calls, {
        page: result.page,
        perPage: result.perPage,
        total: result.total,
      });
    }

    const filter = parsed.data;

    // MANAGER must provide moduleSlug and can only see their own module's calls
    if (!hasRole(session.user as { role: import("@prisma/client").Role }, "SUPERADMIN")) {
      if (!filter.moduleSlug) {
        return apiForbidden("Необходимо указать moduleSlug");
      }
      const denied = await requireAdminSection(session, filter.moduleSlug);
      if (denied) return denied;
    }

    const result = await listCalls(filter);

    return apiResponse(result.calls, {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}
