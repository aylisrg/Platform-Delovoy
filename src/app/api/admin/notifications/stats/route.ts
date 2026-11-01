import { auth } from "@/lib/auth";
import {
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { getNotificationStats } from "@/modules/notifications/stats";
import { notificationStatsQuerySchema } from "@/modules/notifications/validation";

/**
 * GET /api/admin/notifications/stats — delivery & reaction statistics of the
 * team (US-D1, problems US-D4). SUPERADMIN only, even with the
 * «Уведомления» section granted (AC-D1.1). Read-only — no AuditLog.
 * ADR 2026-10-25-team-access-notifications §6.1/§6.2.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = notificationStatsQuerySchema.safeParse(query);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const { period, ...filters } = parsed.data;
    return apiResponse(await getNotificationStats({ days: period, ...filters }));
  } catch (error) {
    console.error("[notifications/stats] unexpected error", error);
    return apiServerError();
  }
}
