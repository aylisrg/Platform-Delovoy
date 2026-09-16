import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiResponse, apiError, requireAdminSection, apiServerError } from "@/lib/api-response";
import { funnelStatsQuerySchema } from "@/modules/analytics/validation";
import { getFunnelStats } from "@/modules/analytics/product-events";

/**
 * GET /api/analytics/funnel — агрегация воронки по шагам за период (AC-1.7,
 * ADR 2026-09-16 §6.2). Данные обезличены (агрегаты по sessionKey-хэшам),
 * поэтому доступ — обычный `requireAdminSection`, без дополнительной
 * фильтрации по `hasModuleAccess` на модули воронок.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const denied = await requireAdminSection(session, "analytics");
  if (denied) return denied;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = funnelStatsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
  }

  try {
    const data = await getFunnelStats(parsed.data);
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
