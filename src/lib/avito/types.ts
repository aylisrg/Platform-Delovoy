/**
 * Avito API integration — types.
 * Architecture: docs/architecture/2026-04-28-delovoy-avito-adr.md
 */

import type { AvitoItemStatus } from "@prisma/client";

export const AVITO_AUTH_URL = "https://api.avito.ru/token";
export const AVITO_API_URL = "https://api.avito.ru";
export const TOKEN_CACHE_KEY = "avito:access_token";

export const AVITO_STATS_PERIODS = ["7d", "30d"] as const;
export type AvitoStatsPeriod = (typeof AVITO_STATS_PERIODS)[number];

export const ATTACHED_MODULES = ["gazebos", "ps-park"] as const;
export type AttachedModule = (typeof ATTACHED_MODULES)[number];

/** Statistic returned by Avito Stats API for a single item over a single period. */
export type AvitoItemStatsResult = {
  views: number;
  uniqViews: number;
  contacts: number;
  favorites: number;
  calls: number;
  missedCalls: number;
};

/** Legacy shape — kept for src/app/admin/gazebos/marketing/page.tsx compatibility. */
export type AvitoMarketingStats = AvitoItemStatsResult & {
  itemId: string;
  dateFrom: string;
  dateTo: string;
  configured: boolean;
};

/** Item record as exposed by /api/avito/items. */
export type AvitoItemDto = {
  id: string;
  avitoItemId: string;
  title: string;
  url: string | null;
  status: AvitoItemStatus;
  moduleSlug: string | null;
  category: string | null;
  priceRub: string | null;
  lastSyncedAt: string | null;
  avgRating: number | null;
  reviewsCount: number;
  stats: AvitoItemStatsSnapshotDto | null;
};

export type AvitoItemStatsSnapshotDto = AvitoItemStatsResult & {
  period: AvitoStatsPeriod;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
  stale: boolean;
};

export type AvitoAccountDto = {
  configured: boolean;
  accountName: string | null;
  avitoUserId: string | null;
  balanceRub: string | null;
  lowBalanceWarning: boolean;
  lastBalanceSyncAt: string | null;
  webhookEnabled: boolean;
  pollEnabled: boolean;
};

export class AvitoApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "AvitoApiError";
  }

  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}
