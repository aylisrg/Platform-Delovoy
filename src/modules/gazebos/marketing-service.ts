/**
 * Marketing analytics aggregator for the Gazebos module.
 * Combines Avito and Yandex stats into a single dashboard payload.
 * Results are cached in Redis for 10 minutes.
 */

import { redis, redisAvailable } from "@/lib/redis";
import { getAvitoItemStats, type AvitoMarketingStats } from "@/lib/avito";
import { getYandexMarketingStats, type YandexMarketingStats } from "@/lib/yandex";

const CACHE_KEY = "gazebos:marketing:stats";
const CACHE_TTL = 600; // 10 minutes

export type GazebosMarketingData = {
  avito: AvitoMarketingStats;
  yandex: YandexMarketingStats;
  cachedAt: string | null;
};

function getDateRange(days = 30): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);

  return {
    dateFrom: from.toISOString().split("T")[0],
    dateTo: to.toISOString().split("T")[0],
  };
}

export async function getGazebosMarketingStats(
  dateFrom?: string,
  dateTo?: string
): Promise<GazebosMarketingData> {
  const range = getDateRange(30);
  const from = dateFrom ?? range.dateFrom;
  const to = dateTo ?? range.dateTo;
  const cacheKey = `${CACHE_KEY}:${from}:${to}`;

  // Try Redis cache first
  if (redisAvailable) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as GazebosMarketingData;
      }
    } catch {
      // Cache miss — proceed to fetch
    }
  }

  // Fetch from both sources in parallel
  const [avito, yandex] = await Promise.all([
    getAvitoItemStats(from, to),
    getYandexMarketingStats(from, to),
  ]);

  const result: GazebosMarketingData = {
    avito,
    yandex,
    cachedAt: new Date().toISOString(),
  };

  // Cache the result
  if (redisAvailable) {
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch {
      // Ignore cache write errors
    }
  }

  return result;
}
