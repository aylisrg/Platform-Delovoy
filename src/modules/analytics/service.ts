import { redis, redisAvailable } from "@/lib/redis";
import { MetrikaClient } from "./metrika-client";
import { DirectClient } from "./direct-client";
import type {
  DateRange,
  OverviewData,
  CampaignsData,
  ConversionsData,
  AdvertisingSummary,
  CampaignStats,
  GoalConversion,
  AccountBalance,
} from "./types";

const CACHE_TTL = 900; // 15 minutes
const BALANCE_CACHE_TTL = 300; // 5 minutes

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

function enrichCampaigns(raw: CampaignStats[]): {
  campaigns: CampaignStats[];
  totals: AdvertisingSummary;
} {
  const totalCost = raw.reduce((sum, c) => sum + c.cost, 0);
  const totalImpressions = raw.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = raw.reduce((sum, c) => sum + c.clicks, 0);

  const campaigns = raw.map((c) => ({
    ...c,
    costShare:
      totalCost > 0 ? Math.round((c.cost / totalCost) * 10000) / 100 : 0,
  }));

  const totals: AdvertisingSummary = {
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr:
      totalImpressions > 0
        ? Math.round((totalClicks / totalImpressions) * 10000) / 100
        : 0,
    cost: Math.round(totalCost * 100) / 100,
    avgCpc:
      totalClicks > 0 ? Math.round((totalCost / totalClicks) * 100) / 100 : 0,
  };

  return { campaigns, totals };
}

function enrichGoals(
  rawGoals: Array<Pick<GoalConversion, "goalId" | "goalName" | "reaches" | "conversionRate">>,
  totalCost: number
): GoalConversion[] {
  const totalReaches = rawGoals.reduce((sum, g) => sum + g.reaches, 0);

  return rawGoals.map((g) => {
    const share =
      totalReaches > 0 ? Math.round((g.reaches / totalReaches) * 10000) / 100 : 0;
    return {
      goalId: g.goalId,
      goalName: g.goalName,
      reaches: g.reaches,
      conversionRate: g.conversionRate,
      shareOfConversions: share,
      attributedCost:
        g.reaches > 0 && totalCost > 0
          ? Math.round(((totalCost * (share / 100))) * 100) / 100
          : null,
    };
  });
}

async function fetchBalance(forceRefresh: boolean): Promise<AccountBalance> {
  const cacheKey = `analytics:balance:${process.env.YANDEX_DIRECT_CLIENT_LOGIN ?? "unknown"}`;

  return withCache(
    cacheKey,
    async () => {
      try {
        const direct = getDirectClient();
        return await direct.getAccountBalance(process.env.YANDEX_DIRECT_BALANCE_MANUAL);
      } catch {
        const manual = process.env.YANDEX_DIRECT_BALANCE_MANUAL;
        if (manual) {
          const parsed = parseFloat(manual.replace(/\s+/g, "").replace(",", "."));
          if (Number.isFinite(parsed)) {
            return {
              amount: parsed,
              currency: "RUB",
              source: "manual_env" as const,
              message: "Значение из YANDEX_DIRECT_BALANCE_MANUAL",
            };
          }
        }
        return {
          amount: null,
          currency: "RUB",
          source: "unavailable" as const,
          message: "Не настроены YANDEX_OAUTH_TOKEN / YANDEX_DIRECT_CLIENT_LOGIN",
        };
      }
    },
    { forceRefresh, ttl: BALANCE_CACHE_TTL }
  ).then((cached) => {
    const { cachedAt, ...rest } = cached;
    void cachedAt;
    return rest;
  });
}

export async function getOverview(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<OverviewData> {
  const cacheKey = `analytics:overview:v2:${dateRange.dateFrom}:${dateRange.dateTo}`;

  return withCache(
    cacheKey,
    async () => {
      const metrika = getMetrikaClient();

      const directFetch = (async () => {
        try {
          const direct = getDirectClient();
          return await direct.getCampaignStats(dateRange.dateFrom, dateRange.dateTo);
        } catch {
          return [];
        }
      })();

      const [traffic, trafficSources, rawGoals, rawCampaigns, balance] = await Promise.all([
        metrika.getTrafficSummary(dateRange.dateFrom, dateRange.dateTo),
        metrika
          .getTrafficSources(dateRange.dateFrom, dateRange.dateTo)
          .catch(() => []),
        metrika.getGoalConversions(dateRange.dateFrom, dateRange.dateTo),
        directFetch,
        fetchBalance(forceRefresh),
      ]);

      const { campaigns, totals } = enrichCampaigns(rawCampaigns);
      const goals = enrichGoals(rawGoals, totals.cost);
      const totalConversions = goals.reduce((sum, g) => sum + g.reaches, 0);

      const activeCampaigns = campaigns.filter(
        (c) => c.status === "ACCEPTED" && c.impressions > 0
      ).length;

      const withTraffic = campaigns.filter((c) => c.impressions > 0);
      const sortedByCtr = [...withTraffic].sort((a, b) => b.ctr - a.ctr);
      const best = sortedByCtr[0];
      const worst = sortedByCtr[sortedByCtr.length - 1];

      return {
        period: dateRange,
        traffic,
        trafficSources,
        advertising: totals,
        balance,
        conversions: goals,
        campaigns,
        summary: {
          totalConversions,
          totalCost: totals.cost,
          avgCostPerConversion:
            totalConversions > 0
              ? Math.round((totals.cost / totalConversions) * 100) / 100
              : null,
          activeCampaigns,
          bestCampaignByCtr: best
            ? { name: best.campaignName, ctr: best.ctr }
            : null,
          worstCampaignByCtr:
            worst && worst !== best
              ? { name: worst.campaignName, ctr: worst.ctr }
              : null,
        },
      };
    },
    { forceRefresh, ttl: CACHE_TTL }
  );
}

export async function getCampaigns(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<CampaignsData> {
  const cacheKey = `analytics:campaigns:v2:${dateRange.dateFrom}:${dateRange.dateTo}`;

  return withCache(
    cacheKey,
    async () => {
      const direct = getDirectClient();
      const raw = await direct.getCampaignStats(dateRange.dateFrom, dateRange.dateTo);
      const { campaigns, totals } = enrichCampaigns(raw);
      const sorted = [...campaigns].sort((a, b) => b.cost - a.cost);
      return { period: dateRange, campaigns: sorted, totals };
    },
    { forceRefresh, ttl: CACHE_TTL }
  );
}

export async function getConversions(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<ConversionsData> {
  const cacheKey = `analytics:conversions:v2:${dateRange.dateFrom}:${dateRange.dateTo}`;

  return withCache(
    cacheKey,
    async () => {
      const metrika = getMetrikaClient();

      const directFetch = (async () => {
        try {
          const direct = getDirectClient();
          return await direct.getCampaignStats(dateRange.dateFrom, dateRange.dateTo);
        } catch {
          return [];
        }
      })();

      const [rawGoals, rawCampaigns, traffic] = await Promise.all([
        metrika.getGoalConversions(dateRange.dateFrom, dateRange.dateTo),
        directFetch,
        metrika.getTrafficSummary(dateRange.dateFrom, dateRange.dateTo),
      ]);

      const totalCost = rawCampaigns.reduce((sum, c) => sum + c.cost, 0);
      const goals = enrichGoals(rawGoals, totalCost);
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
      };
    },
    { forceRefresh, ttl: CACHE_TTL }
  );
}

export async function getBalance(forceRefresh: boolean): Promise<AccountBalance> {
  return fetchBalance(forceRefresh);
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
