import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { listOrders } from "@/modules/cafe/service";
import { orderFilterSchema } from "@/modules/cafe/validation";

/**
 * GET /api/cafe/orders — list orders with optional filters.
 *
 * USER видит только собственные заказы; персонал (MANAGER+ с секцией cafe) —
 * любые. Раньше роут был без guard'а и отдавал все заказы анониму.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = orderFilterSchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const filter = { ...parsed.data };
    if (hasRole(session.user, "MANAGER")) {
      const denied = await requireAdminSection(session, "cafe");
      if (denied) return denied;
    } else {
      filter.userId = session.user.id; // обычный пользователь — только свои
    }

    const { orders, total } = await listOrders(filter);
    return apiResponse(orders, { total });
  } catch {
    return apiServerError();
  }
}
