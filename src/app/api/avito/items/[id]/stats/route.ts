import { NextRequest } from "next/server";
import {
  apiForbidden,
  apiNotFound,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasAdminSectionAccess, hasModuleAccess } from "@/lib/permissions";
import { isSnapshotStale } from "@/lib/avito";
import { AvitoStatsQuerySchema } from "@/lib/avito/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/avito/items/:id/stats?period=7d|30d
 * Returns the latest snapshot from the DB. UI renders `stale=true` if older than 30 min.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { id } = await params;

    const item = await prisma.avitoItem.findUnique({ where: { id } });
    if (!item) return apiNotFound("Объявление не найдено");

    if (session.user.role !== "SUPERADMIN") {
      const sectionOk = await hasAdminSectionAccess(session.user.id, "avito");
      if (!sectionOk) return apiForbidden("Нет доступа к разделу Деловой Авито");
      if (item.moduleSlug) {
        const moduleOk = await hasModuleAccess(session.user.id, item.moduleSlug);
        if (!moduleOk) return apiForbidden("Нет доступа к модулю объявления");
      }
    }

    const parsed = AvitoStatsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) return apiValidationError(parsed.error.issues[0]?.message ?? "invalid query");

    const snap = await prisma.avitoItemStatsSnapshot.findUnique({
      where: { avitoItemId_period: { avitoItemId: id, period: parsed.data.period } },
    });

    if (!snap) {
      return apiResponse({ stats: null, stale: true });
    }

    return apiResponse({
      stats: {
        period: parsed.data.period,
        dateFrom: snap.dateFrom.toISOString(),
        dateTo: snap.dateTo.toISOString(),
        views: snap.views,
        uniqViews: snap.uniqViews,
        contacts: snap.contacts,
        favorites: snap.favorites,
        calls: snap.calls,
        missedCalls: snap.missedCalls,
        syncedAt: snap.syncedAt.toISOString(),
        stale: isSnapshotStale(snap.syncedAt),
      },
    });
  } catch (err) {
    console.error("[GET /api/avito/items/:id/stats] error", err);
    return apiServerError();
  }
}
