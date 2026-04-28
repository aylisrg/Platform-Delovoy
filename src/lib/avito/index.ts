/**
 * Avito integration package — public entry point.
 *
 * Re-exports the most commonly used types and helpers, and preserves
 * `getAvitoItemStats(dateFrom, dateTo)` to avoid breaking
 * src/app/admin/gazebos/marketing/page.tsx until that page migrates to the
 * per-item endpoint introduced in PR-1.
 *
 * See docs/architecture/2026-04-28-delovoy-avito-adr.md
 */

import { prisma } from "@/lib/db";
import { fetchItemStatsFromAvito } from "./items";
import {
  isAvitoCredentialsConfigured,
  isLegacyEnvConfigured,
} from "./client";
import type { AvitoMarketingStats } from "./types";

export type {
  AvitoAccountDto,
  AvitoItemDto,
  AvitoItemStatsResult,
  AvitoItemStatsSnapshotDto,
  AvitoMarketingStats,
  AvitoStatsPeriod,
  AttachedModule,
} from "./types";
export { AvitoApiError, ATTACHED_MODULES, AVITO_STATS_PERIODS } from "./types";
export { isAvitoCredentialsConfigured, isLegacyEnvConfigured, getAccessToken, avitoFetch } from "./client";
export {
  listAvitoItems,
  refreshItemSnapshot,
  fetchItemStatsFromAvito,
  isSnapshotStale,
  periodRange,
  syncItemsRegistry,
} from "./items";
export { getAccountSnapshot, syncAccount, fetchSelfAccount, fetchBalance } from "./account";
export {
  fetchReviewsForItem,
  syncReviewsForItem,
  syncAllReviews,
  NEGATIVE_RATING_THRESHOLD,
} from "./reviews";
export type { RawAvitoReview } from "./reviews";

/**
 * Legacy: aggregate stats for a single item (backed by AVITO_ITEM_ID env or
 * the first registered AvitoItem with moduleSlug='gazebos').
 *
 * dateFrom/dateTo are ISO date strings (YYYY-MM-DD).
 */
export async function getAvitoItemStats(
  dateFrom: string,
  dateTo: string
): Promise<AvitoMarketingStats> {
  const empty: AvitoMarketingStats = {
    itemId: process.env.AVITO_ITEM_ID ?? "",
    views: 0,
    uniqViews: 0,
    contacts: 0,
    favorites: 0,
    calls: 0,
    missedCalls: 0,
    dateFrom,
    dateTo,
    configured: false,
  };

  if (!isAvitoCredentialsConfigured()) return empty;

  // Resolve target avitoItemId: prefer DB registry, fall back to legacy env var.
  let resolvedAvitoItemId: string | null = null;
  try {
    const item = await prisma.avitoItem.findFirst({
      where: { moduleSlug: "gazebos", deletedAt: null, status: "ACTIVE" },
      select: { avitoItemId: true },
      orderBy: { createdAt: "asc" },
    });
    resolvedAvitoItemId = item?.avitoItemId ?? null;
  } catch {
    // DB unavailable — fall back to env
  }
  if (!resolvedAvitoItemId && isLegacyEnvConfigured()) {
    resolvedAvitoItemId = process.env.AVITO_ITEM_ID ?? null;
  }
  if (!resolvedAvitoItemId) return empty;

  try {
    const stats = await fetchItemStatsFromAvito(
      resolvedAvitoItemId,
      new Date(dateFrom),
      new Date(dateTo)
    );
    return {
      itemId: resolvedAvitoItemId,
      ...stats,
      dateFrom,
      dateTo,
      configured: true,
    };
  } catch {
    return { ...empty, itemId: resolvedAvitoItemId, configured: true };
  }
}
