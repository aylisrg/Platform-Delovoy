import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiUnauthorized,
} from "@/lib/api-response";
import { RELEASE_EVENT_TYPE } from "@/modules/notifications/release-notify";
import { setStaffEventSubscription } from "@/modules/notifications/subscriptions";
import { NotificationDomainError } from "@/modules/notifications/errors";

/**
 * PATCH /api/users/:id/notify-releases
 *
 * Toggle release notification subscription for a staff member.
 * Only SUPERADMIN. Same write path (and AuditLog) as every other
 * subscription toggle (ADR 2026-10-25-team-access-notifications §5.2).
 */

const schema = z.object({ enabled: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "enabled must be a boolean", 400);
    }

    await setStaffEventSubscription({
      targetUserId: id,
      eventType: RELEASE_EVENT_TYPE,
      enabled: parsed.data.enabled,
      actor: { userId: session.user.id, via: "admin" },
    });

    return apiResponse({ notifyReleases: parsed.data.enabled });
  } catch (error) {
    if (error instanceof NotificationDomainError) {
      if (error.code === "USER_NOT_FOUND") {
        return apiError("NOT_FOUND", "Пользователь не найден", 404);
      }
      if (error.code === "NOT_IN_TEAM") {
        return apiError(
          "INVALID_ROLE",
          "Только администраторы и менеджеры могут получать нотификации о релизах",
          400
        );
      }
    }
    return apiError("INTERNAL_ERROR", "Ошибка обновления настроек", 500);
  }
}
