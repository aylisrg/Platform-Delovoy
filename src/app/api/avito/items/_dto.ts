import type { AvitoItem, AvitoItemStatsSnapshot } from "@prisma/client";
import { isSnapshotStale } from "@/lib/avito";
import type { AvitoItemDto, AvitoStatsPeriod } from "@/lib/avito";

type ItemWithSnapshot = AvitoItem & { statsSnapshots: AvitoItemStatsSnapshot[] };

export function itemsToDto(items: ItemWithSnapshot[], period: AvitoStatsPeriod): AvitoItemDto[] {
  return items.map((it) => itemToDto(it, period));
}

export function itemToDto(item: ItemWithSnapshot, period: AvitoStatsPeriod): AvitoItemDto {
  const snap = item.statsSnapshots[0];
  return {
    id: item.id,
    avitoItemId: item.avitoItemId,
    title: item.title,
    url: item.url,
    status: item.status,
    moduleSlug: item.moduleSlug,
    category: item.category,
    priceRub: item.priceRub ? item.priceRub.toString() : null,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    avgRating: item.avgRating,
    reviewsCount: item.reviewsCount,
    stats: snap
      ? {
          period,
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
        }
      : null,
  };
}
