import { auth } from "@/lib/auth";
import { apiForbidden, apiResponse, apiServerError, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { getNotificationMatrix } from "@/modules/notifications/matrix";
import { notificationMatrixQuerySchema } from "@/modules/notifications/validation";

/**
 * GET /api/admin/notifications/matrix — «сотрудники × события» (US-C4).
 * The proxy lets ADMIN/MANAGER into /api/admin/*, so the route itself is
 * SUPERADMIN-only (ADR 2026-10-25-team-access-notifications §6.1).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const parsed = notificationMatrixQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiValidationError(parsed.error.issues[0]?.message ?? "Некорректный запрос");

  try {
    return apiResponse(await getNotificationMatrix(parsed.data));
  } catch (error) {
    console.error("[notifications/matrix] error", error);
    return apiServerError();
  }
}
