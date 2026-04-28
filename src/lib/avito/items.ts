/**
 * AvitoItem registry, per-item statistics + snapshot management.
 * UI reads exclusively from AvitoItemStatsSnapshot — Avito API is hit only by cron / manual refresh.
 */

import { prisma } from "@/lib/db";
import { avitoFetch, isAvitoCredentialsConfigured } from "./client";
import {
  type AvitoItemStatsResult,
  type AvitoStatsPeriod,
  AvitoApiError,
} from "./types";

const PERIOD_DAYS: Record<AvitoStatsPeriod, number> = { "7d": 7, "30d": 30 };
const STATS_FRESH_SECONDS = 30 * 60;

export function periodRange(period: AvitoStatsPeriod, now = new Date()): { dateFrom: Date; dateTo: Date } {
  const days = PERIOD_DAYS[period];
  const dateTo = new Date(now);
  dateTo.setUTCHours(23, 59, 59, 999);
  const dateFrom = new Date(dateTo);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - days + 1);
  dateFrom.setUTCHours(0, 0, 0, 0);
  return { dateFrom, dateTo };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch metrics for a single AvitoItem from Avito API.
 * Combines /stats/v1/accounts/self/items + /call-tracking/v1/accounts/self/calls/stats.
 */
export async function fetchItemStatsFromAvito(
  avitoItemId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<AvitoItemStatsResult> {
  if (!isAvitoCredentialsConfigured()) {
    return { views: 0, uniqViews: 0, contacts: 0, favorites: 0, calls: 0, missedCalls: 0 };
  }

  const numericId = Number.parseInt(avitoItemId, 10);
  if (!Number.isFinite(numericId)) {
    throw new AvitoApiError(400, `Invalid avitoItemId: ${avitoItemId}`);
  }

  const fromStr = isoDate(dateFrom);
  const toStr = isoDate(dateTo);

  const [statsResult, callsResult] = await Promise.allSettled([
    avitoFetch<{
      result?: {
        items?: Array<{
          stats?: Array<{
            uniqViews?: number;
            views?: number;
            contacts?: number;
            favorites?: number;
          }>;
        }>;
      };
    }>("/stats/v1/accounts/self/items", {
      method: "POST",
      body: {
        dateFrom: fromStr,
        dateTo: toStr,
        fields: ["uniqViews", "views", "contacts", "favorites"],
        itemIds: [numericId],
        periodGrouping: "total",
      },
    }),
    avitoFetch<{ result?: { totalCalls?: number; missedCalls?: number } }>(
      "/call-tracking/v1/accounts/self/calls/stats",
      { query: { itemId: avitoItemId, dateFrom: fromStr, dateTo: toStr } }
    ),
  ]);

  let views = 0;
  let uniqViews = 0;
  let contacts = 0;
  let favorites = 0;
  if (statsResult.status === "fulfilled") {
    const s = statsResult.value?.result?.items?.[0]?.stats?.[0];
    views = s?.views ?? 0;
    uniqViews = s?.uniqViews ?? 0;
    contacts = s?.contacts ?? 0;
    favorites = s?.favorites ?? 0;
  }

  let calls = 0;
  let missedCalls = 0;
  if (callsResult.status === "fulfilled") {
    calls = callsResult.value?.result?.totalCalls ?? 0;
    missedCalls = callsResult.value?.result?.missedCalls ?? 0;
  }

  return { views, uniqViews, contacts, favorites, calls, missedCalls };
}

/**
 * Refresh snapshot for one item × one period. Persists to AvitoItemStatsSnapshot.
 * Returns the updated row.
 */
export async function refreshItemSnapshot(
  avitoItemDbId: string,
  avitoItemId: string,
  period: AvitoStatsPeriod
) {
  const { dateFrom, dateTo } = periodRange(period);
  let stats: AvitoItemStatsResult;
  let lastSyncError: string | null = null;
  try {
    stats = await fetchItemStatsFromAvito(avitoItemId, dateFrom, dateTo);
  } catch (err) {
    stats = { views: 0, uniqViews: 0, contacts: 0, favorites: 0, calls: 0, missedCalls: 0 };
    lastSyncError = err instanceof Error ? err.message : "unknown error";
  }

  const snapshot = await prisma.avitoItemStatsSnapshot.upsert({
    where: { avitoItemId_period: { avitoItemId: avitoItemDbId, period } },
    create: { avitoItemId: avitoItemDbId, period, dateFrom, dateTo, ...stats },
    update: { dateFrom, dateTo, ...stats, syncedAt: new Date() },
  });

  await prisma.avitoItem.update({
    where: { id: avitoItemDbId },
    data: { lastSyncedAt: new Date(), lastSyncError },
  });

  return snapshot;
}

export function isSnapshotStale(syncedAt: Date | null | undefined): boolean {
  if (!syncedAt) return true;
  const ageSec = (Date.now() - syncedAt.getTime()) / 1000;
  return ageSec > STATS_FRESH_SECONDS;
}

/**
 * List all known items, optionally filtered by moduleSlug.
 * Returns items with their primary period snapshot eagerly loaded.
 */
export async function listAvitoItems(filter: {
  moduleSlug?: string | null;
  includeRemoved?: boolean;
  period?: AvitoStatsPeriod;
}) {
  const period = filter.period ?? "7d";
  return prisma.avitoItem.findMany({
    where: {
      moduleSlug: filter.moduleSlug === undefined ? undefined : filter.moduleSlug,
      ...(filter.includeRemoved ? {} : { deletedAt: null, status: { not: "REMOVED" } }),
    },
    include: {
      statsSnapshots: { where: { period }, take: 1 },
    },
    orderBy: [{ moduleSlug: "asc" }, { title: "asc" }],
  });
}

/**
 * Sync the items registry from Avito Core API.
 * For each item Avito returns we upsert AvitoItem (avitoItemId is UNIQUE).
 * Items present in the registry but missing from Avito are marked status=REMOVED + deletedAt.
 */
export async function syncItemsRegistry(): Promise<{ added: number; updated: number; removed: number }> {
  if (!isAvitoCredentialsConfigured()) return { added: 0, updated: 0, removed: 0 };

  type AvitoItemPayload = {
    id: number;
    title: string;
    url?: string;
    status?: string;
    category?: { name?: string };
    price?: number;
  };

  // Avito paginates with cursor `?per_page=100&page=N` until no items.
  const collected: AvitoItemPayload[] = [];
  for (let page = 1; page < 50; page++) {
    const res = await avitoFetch<{ resources?: AvitoItemPayload[] }>("/core/v1/items", {
      query: { per_page: 100, page },
    });
    const batch = res?.resources ?? [];
    if (batch.length === 0) break;
    collected.push(...batch);
    if (batch.length < 100) break;
  }

  const seenIds = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const item of collected) {
    const avitoItemId = String(item.id);
    seenIds.add(avitoItemId);
    const status = mapAvitoStatus(item.status);
    const existed = await prisma.avitoItem.findUnique({ where: { avitoItemId } });
    await prisma.avitoItem.upsert({
      where: { avitoItemId },
      create: {
        avitoItemId,
        title: item.title,
        url: item.url ?? null,
        status,
        category: item.category?.name ?? null,
        priceRub: item.price !== undefined ? String(item.price) : null,
      },
      update: {
        title: item.title,
        url: item.url ?? null,
        status,
        category: item.category?.name ?? null,
        priceRub: item.price !== undefined ? String(item.price) : null,
        deletedAt: null,
      },
    });
    if (existed) updated += 1;
    else added += 1;
  }

  let removed = 0;
  if (seenIds.size > 0) {
    const result = await prisma.avitoItem.updateMany({
      where: { avitoItemId: { notIn: Array.from(seenIds) }, deletedAt: null },
      data: { status: "REMOVED", deletedAt: new Date() },
    });
    removed = result.count;
  }

  return { added, updated, removed };
}

function mapAvitoStatus(status?: string): "ACTIVE" | "ARCHIVED" | "BLOCKED" | "REMOVED" {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "old":
    case "archived":
      return "ARCHIVED";
    case "blocked":
    case "rejected":
      return "BLOCKED";
    case "removed":
      return "REMOVED";
    default:
      return "ACTIVE";
  }
}
