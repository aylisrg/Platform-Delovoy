import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiUnauthorized,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { setReleaseNotifyPreference } from "@/modules/notifications/release-notify";

/**
 * PATCH /api/users/:id/notify-releases
 *
 * Toggle release notification subscription for an admin/manager.
 * Only SUPERADMIN can change this setting.
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

    const user = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });

    if (!user) {
      return apiError("NOT_FOUND", "Пользователь не найден", 404);
    }

    if (user.role === "USER") {
      return apiError(
        "INVALID_ROLE",
        "Только администраторы и менеджеры могут получать нотификации о релизах",
        400
      );
    }

    await setReleaseNotifyPreference(id, parsed.data.enabled);

    return apiResponse({ notifyReleases: parsed.data.enabled });
  } catch {
    return apiError("INTERNAL_ERROR", "Ошибка обновления настроек", 500);
  }
}
