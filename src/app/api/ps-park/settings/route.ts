import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError, apiNotFound, requireAdminSection } from "@/lib/api-response";
import { moduleSettingsSchema } from "@/modules/ps-park/validation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

const MODULE_SLUG = "ps-park";

/**
 * GET /api/ps-park/settings
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const moduleRecord = await prisma.module.findUnique({
      where: { slug: MODULE_SLUG },
    });
    if (!moduleRecord) return apiNotFound("Модуль не найден");

    const defaults = {
      openHour: 8,
      closeHour: 23,
      minBookingHours: 1,
      // Должен совпадать с DEFAULT_SLOT_ROUNDING_MINUTES в ps-park/service.ts —
      // это реальное поведение биллинга, когда Module.config пуст. Расхождение
      // молча переключало бы округление счёта на 30 мин при любом сохранении
      // формы настроек (#434 code review).
      slotRoundingMinutes: 15,
      sessionAlertMinutes: 10,
      telegramChannelEnabled: false,
      telegramChannelName: "",
      telegramChannelId: "",
      telegramChannelEvents: [] as string[],
    };
    const config = (moduleRecord.config as Record<string, unknown>) ?? {};

    return apiResponse({ ...defaults, ...config });
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/ps-park/settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const body = await request.json();
    const parsed = moduleSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Module" WHERE slug = ${MODULE_SLUG} FOR UPDATE`;
      const moduleRecord = await tx.module.findUnique({ where: { slug: MODULE_SLUG } });
      if (!moduleRecord) return null;

      const currentConfig = (moduleRecord.config as Record<string, unknown>) ?? {};
      const newConfig = { ...currentConfig, ...parsed.data };
      const savedModule = await tx.module.update({ where: { slug: MODULE_SLUG }, data: { config: newConfig } });
      await tx.auditLog.create({
        data: {
          userId: session!.user.id,
          action: "module.settings.update",
          entity: "Module",
          entityId: savedModule.id,
          metadata: JSON.parse(JSON.stringify({ before: currentConfig, after: newConfig })),
        },
      });
      return savedModule;
    });
    if (!updated) return apiNotFound("Модуль не найден");
    return apiResponse(updated.config);
  } catch {
    return apiServerError();
  }
}
