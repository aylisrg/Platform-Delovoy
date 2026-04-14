import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError, apiNotFound, requireAdminSection } from "@/lib/api-response";
import { moduleSettingsSchema } from "@/modules/gazebos/validation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

const MODULE_SLUG = "gazebos";

/**
 * GET /api/gazebos/settings
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const moduleRecord = await prisma.module.findUnique({
      where: { slug: MODULE_SLUG },
    });
    if (!moduleRecord) return apiNotFound("Модуль не найден");

    return apiResponse(moduleRecord.config ?? {
      openHour: 8,
      closeHour: 23,
      minBookingHours: 1,
      maxBookingHours: 8,
    });
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/gazebos/settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const body = await request.json();
    const parsed = moduleSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const moduleRecord = await prisma.module.findUnique({
      where: { slug: MODULE_SLUG },
    });
    if (!moduleRecord) return apiNotFound("Модуль не найден");

    const currentConfig = (moduleRecord.config as Record<string, unknown>) ?? {};
    const newConfig = { ...currentConfig, ...parsed.data };

    const updated = await prisma.module.update({
      where: { slug: MODULE_SLUG },
      data: { config: newConfig },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: session!.user.id,
        action: "module.settings.update",
        entity: "Module",
        entityId: updated.id,
        metadata: JSON.parse(JSON.stringify({ before: currentConfig, after: newConfig })),
      },
    });

    return apiResponse(updated.config);
  } catch {
    return apiServerError();
  }
}
