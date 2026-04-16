import { redis, redisAvailable } from "@/lib/redis";
import { MetrikaClient } from "./metrika-client";
import { DirectClient } from "./direct-client";
import type {
  DateRange,
  OverviewData,
  CampaignsData,
  ConversionsData,
  AdvertisingSummary,
} from "./types";

const CACHE_TTL = 900; // 15 minutes
const GOALS_CACHE_TTL = 3600; // 1 hour

function getMetrikaClient(): MetrikaClient {
  const token = process.env.YANDEX_OAUTH_TOKEN;
  const counterId = process.env.YANDEX_METRIKA_COUNTER_ID || "73068007";
  if (!token) throw new Error("YANDEX_TOKEN_MISSING: YANDEX_OAUTH_TOKEN not set");
  return new MetrikaClient(token, counterId);
}

function getDirectClient(): DirectClient {
  const token = process.env.YANDEX_OAUTH_TOKEN;
  const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN;
  if (!token) throw new Error("YANDEX_TOKEN_MISSING: YANDEX_OAUTH_TOKEN not set");
  if (!login) throw new Error("YANDEX_TOKEN_MISSING: YANDEX_DIRECT_CLIENT_LOGIN not set");
  return new DirectClient(token, login);
}

export function resolveDateRange(params: {
  dateFrom?: string;
  dateTo?: string;
  period?: "today" | "7d" | "30d";
}): DateRange {
  const today = new Date().toISOString().slice(0, 10);

  if (params.dateFrom && params.dateTo) {
    return { dateFrom: params.dateFrom, dateTo: params.dateTo };
  }

  const period = params.period ?? "7d";
  const end = new Date();
  let start: Date;

  switch (period) {
    case "today":
      start = new Date();
      break;
    case "30d":
      start = new Date();
      start.setDate(start.getDate() - 29);
      break;
    case "7d":
    default:
      start = new Date();
      start.setDate(start.getDate() - 6);
      break;
  }

  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: today,
  };
}

export async function getOverview(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<OverviewData> {
  const cacheKey = `analytics:overview:${dateRange.dateFrom}:${dateRange.dateTo}`;

  return withCache(cacheKey, async () => {
    const metrika = getMetrikaClient();

    const directFetch = (async () => {
      try {
        const direct = getDirectClient();
        return await direct.getCampaignStats(dateRange.dateFrom, dateRange.dateTo);
      } catch {
        return [];
      }
    })();

    const [traffic, goals, campaigns] = await Promise.all([
      metrika.getTrafficSummary(dateRange.dateFrom, dateRange.dateTo),
      metrika.getGoalConversions(dateRange.dateFrom, dateRange.dateTo),
      directFetch,
    ]);

    const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);
    const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const totalConversions = goals.reduce((sum, g) => sum + g.reaches, 0);

    const conversionsWithCost = goals.map((g) => ({
      ...g,
      costPerConversion: g.reaches > 0 ? Math.round((totalCost / g.reaches) * 100) / 100 : null,
    }));

    return {
      period: dateRange,
      traffic,
      advertising: {
        impressions: totalImpressions,
        clicks: totalClicks,
        ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0,
        cost: Math.round(totalCost * 100) / 100,
        avgCpc: totalClicks > 0 ? Math.round((totalCost / totalClicks) * 100) / 100 : 0,
      },
      conversions: conversionsWithCost,
      summary: {
        totalConversions,
        totalCost: Math.round(totalCost * 100) / 100,
        avgCostPerConversion:
          totalConversions > 0
            ? Math.round((totalCost / totalConversions) * 100) / 100
            : null,
      },
    };
  }, { forceRefresh, ttl: CACHE_TTL });
}

export async function getCampaigns(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<CampaignsData> {
  const cacheKey = `analytics:campaigns:${dateRange.dateFrom}:${dateRange.dateTo}`;

  return withCache(cacheKey, async () => {
    const direct = getDirectClient();
    const campaigns = await direct.getCampaignStats(dateRange.dateFrom, dateRange.dateTo);

    const sorted = [...campaigns].sort((a, b) => b.cost - a.cost);
    const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);

    const totals: AdvertisingSummary = {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0,
      cost: Math.round(totalCost * 100) / 100,
      avgCpc: totalClicks > 0 ? Math.round((totalCost / totalClicks) * 100) / 100 : 0,
    };

    return { period: dateRange, campaigns: sorted, totals };
  }, { forceRefresh, ttl: CACHE_TTL });
}

export async function getConversions(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<ConversionsData> {
  const cacheKey = `analytics:conversions:${dateRange.dateFrom}:${dateRange.dateTo}`;

  return withCache(cacheKey, async () => {
    const metrika = getMetrikaClient();

    const directFetch = (async () => {
      try {
        const direct = getDirectClient();
        return await direct.getCampaignStats(dateRange.dateFrom, dateRange.dateTo);
      } catch {
        return [];
      }
    })();

    const [goals, campaigns] = await Promise.all([
      metrika.getGoalConversions(dateRange.dateFrom, dateRange.dateTo),
      directFetch,
    ]);

    const traffic = await metrika.getTrafficSummary(dateRange.dateFrom, dateRange.dateTo);
    const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);
    const totalReaches = goals.reduce((sum, g) => sum + g.reaches, 0);

    return {
      period: dateRange,
      goals,
      funnel: {
        totalVisits: traffic.visits,
        totalGoalReaches: totalReaches,
        overallConversionRate:
          traffic.visits > 0
            ? Math.round((totalReaches / traffic.visits) * 10000) / 100
            : 0,
      },
      costPerConversion: goals.map((g) => ({
        goalName: g.goalName,
        reaches: g.reaches,
        totalCost: Math.round(totalCost * 100) / 100,
        costPerReach:
          g.reaches > 0 ? Math.round((totalCost / g.reaches) * 100) / 100 : null,
      })),
    };
  }, { forceRefresh, ttl: CACHE_TTL });
}

// --- Cache helper ---

async function withCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  options: { forceRefresh: boolean; ttl: number }
): Promise<T & { cachedAt: string }> {
  if (redisAvailable && !options.forceRefresh) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as T & { cachedAt: string };
      }
    } catch {
      // Redis error, proceed without cache
    }
  }

  if (redisAvailable && options.forceRefresh) {
    try {
      await redis.del(cacheKey);
    } catch {
      // ignore
    }
  }

  const data = await fetcher();
  const result = { ...data, cachedAt: new Date().toISOString() };

  if (redisAvailable) {
    try {
      await redis.setex(cacheKey, options.ttl, JSON.stringify(result));
    } catch {
      // Cache write failed, data still returned
    }
  }

  return result;
}
