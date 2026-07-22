import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getCafeStats } from "@/modules/cafe/service";
import { statsQuerySchema } from "@/modules/cafe/validation";

/**
 * GET /api/cafe/stats?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD —
 * статистика продаж кафе (персонал секции cafe).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "cafe");
    if (denied) return denied;

    const parsed = statsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const stats = await getCafeStats(parsed.data);
    return apiResponse(stats);
  } catch {
    return apiServerError();
  }
}
