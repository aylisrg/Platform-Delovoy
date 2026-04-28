import { NextRequest } from "next/server";
import {
  apiError,
  apiForbidden,
  apiNotFound,
  apiResponse,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasAdminSectionAccess, hasModuleAccess } from "@/lib/permissions";
import { refreshItemSnapshot, type AvitoStatsPeriod } from "@/lib/avito";
import { redis, redisAvailable } from "@/lib/redis";
import { itemToDto } from "../../_dto";

export const dynamic = "force-dynamic";

const PERIODS: AvitoStatsPeriod[] = ["7d", "30d"];

async function slidingWindowAllow(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (!redisAvailable) return true;
  try {
    const now = Date.now();
    const windowStart = now - windowSec * 1000;
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}:${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, windowSec);
    const results = await pipeline.exec();
    const count = results?.[2]?.[1] as number | undefined;
    return (count ?? 0) <= limit;
  } catch {
    return true;
  }
}

/**
 * POST /api/avito/items/:id/refresh — force-refresh Avito stats snapshots.
 * Rate-limited per user (5/min) AND per item globally (20/min).
 */
export async function POST(
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

    if (!(await slidingWindowAllow(`avito:refresh:user:${session.user.id}`, 5, 60))) {
      return apiError("RATE_LIMITED", "Слишком частые обновления", 429);
    }
    if (!(await slidingWindowAllow(`avito:refresh:item:${id}`, 20, 60))) {
      return apiError("RATE_LIMITED", "Объявление сейчас обновляется", 429);
    }

    for (const period of PERIODS) {
      await refreshItemSnapshot(item.id, item.avitoItemId, period);
    }

    const fresh = await prisma.avitoItem.findUnique({
      where: { id },
      include: { statsSnapshots: { where: { period: "7d" }, take: 1 } },
    });
    if (!fresh) return apiNotFound("Объявление не найдено");
    return apiResponse({ item: itemToDto(fresh, "7d") });
  } catch (err) {
    console.error("[POST /api/avito/items/:id/refresh] error", err);
    return apiServerError();
  }
}
