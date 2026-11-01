import { auth } from "@/lib/auth";
import {
  apiError,
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { NotificationDomainError } from "@/modules/notifications/errors";
import { getUserNotificationStats } from "@/modules/notifications/stats";
import { statsPeriodSchema } from "@/modules/notifications/validation";
import { userIdParamSchema } from "@/modules/users/validation";

/**
 * GET /api/users/[id]/notification-stats?period=7|30|90 — the «Статистика»
 * block of the staff page (US-D2). SUPERADMIN only. Never returns message
 * texts or channel message ids (AC-D2.2). Read-only — no AuditLog.
 * ADR 2026-10-25-team-access-notifications §6.1/§6.2.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) return apiValidationError("Некорректный идентификатор пользователя");

  const parsed = statsPeriodSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    return apiResponse(await getUserNotificationStats(id.data, parsed.data.period));
  } catch (error) {
    if (error instanceof NotificationDomainError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error("[users/notification-stats] unexpected error", error);
    return apiServerError();
  }
}
