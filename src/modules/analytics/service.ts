import { redis, redisAvailable } from "@/lib/redis";
import { toISODate } from "@/lib/format";
import { MetrikaClient, type RawGoalConversion, type AdSourceMetrics } from "./metrika-client";
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

// Отчёт CAMPAIGN_PERFORMANCE_REPORT в direct-client.ts всегда запрашивается
// с IncludeVAT: "YES" — это влияет на сверку с кабинетом Директа, где могут
// быть включены оба представления.
const COST_INCLUDES_VAT = true;

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

/**
 * Сегодняшняя дата в часовом поясе Москвы — синхронизирует наши периоды
 * с тем, что показывает кабинет Яндекс.Директа.
 */
function moscowToday(): string {
  return toISODate(new Date());
}

function moscowDateMinusDays(days: number): string {
  const now = new Date();
  // Возьмём ISO-полдень "сегодня" в Москве, отнимем нужное число суток.
  const todayMoscow = toISODate(now); // "YYYY-MM-DD"
  const [y, m, d] = todayMoscow.split("-").map(Number);
  // Полдень UTC безопасен от DST-проблем при сдвиге на сутки.
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() - days);
  return toISODate(base);
}

export function resolveDateRange(params: {
  dateFrom?: string;
  dateTo?: string;
  period?: "today" | "7d" | "30d";
}): DateRange {
  if (params.dateFrom && params.dateTo) {
    return { dateFrom: params.dateFrom, dateTo: params.dateTo };
  }

  const period = params.period ?? "7d";
  const today = moscowToday();

  switch (period) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "30d":
      return { dateFrom: moscowDateMinusDays(29), dateTo: today };
    case "7d":
    default:
      return { dateFrom: moscowDateMinusDays(6), dateTo: today };
  }
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
  rawGoals: RawGoalConversion[],
  adMetrics: AdSourceMetrics | null,
  totalCost: number
): GoalConversion[] {
  const totalReaches = rawGoals.reduce((sum, g) => sum + g.reaches, 0);
  const totalAdReaches = adMetrics
    ? rawGoals.reduce((sum, g) => sum + (adMetrics.goalReaches.get(g.goalId) ?? 0), 0)
    : 0;

  return rawGoals.map((g) => {
    const reachesFromAds = adMetrics?.goalReaches.get(g.goalId) ?? 0;
    const share =
      totalReaches > 0
        ? Math.round((g.reaches / totalReaches) * 10000) / 100
        : 0;

    // Распределённый расход — по доле РЕКЛАМНЫХ достижений, а не общих.
    // Если у цели нет ad-достижений, расход на неё не приписываем.
    const attributedCost =
      totalAdReaches > 0 && totalCost > 0
        ? Math.round(((reachesFromAds / totalAdReaches) * totalCost) * 100) / 100
        : null;

    const costPerAdConversion =
      reachesFromAds > 0 && totalCost > 0
        ? Math.round((totalCost / totalAdReaches) * 100) / 100
        : null;

    return {
      goalId: g.goalId,
      goalName: g.goalName,
      goalType: g.goalType,
      reaches: g.reaches,
      reachesFromAds,
      conversionRate: g.conversionRate,
      shareOfConversions: share,
      attributedCost,
      costPerAdConversion,
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

async function safeAdSourceMetrics(
  metrika: MetrikaClient,
  dateFrom: string,
  dateTo: string
): Promise<AdSourceMetrics | null> {
  try {
    return await metrika.getAdSourceMetrics(dateFrom, dateTo);
  } catch {
    return null;
  }
}

export async function getOverview(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<OverviewData> {
  const cacheKey = `analytics:overview:v3:${dateRange.dateFrom}:${dateRange.dateTo}`;

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

      const [traffic, trafficSources, rawGoals, adMetrics, rawCampaigns, balance] =
        await Promise.all([
          metrika.getTrafficSummary(dateRange.dateFrom, dateRange.dateTo),
          metrika
            .getTrafficSources(dateRange.dateFrom, dateRange.dateTo)
            .catch(() => []),
          metrika.getGoalConversions(dateRange.dateFrom, dateRange.dateTo),
          safeAdSourceMetrics(metrika, dateRange.dateFrom, dateRange.dateTo),
          directFetch,
          fetchBalance(forceRefresh),
        ]);

      const { campaigns, totals } = enrichCampaigns(rawCampaigns);
      const goals = enrichGoals(rawGoals, adMetrics, totals.cost);
      const totalConversions = goals.reduce((sum, g) => sum + g.reaches, 0);
      const adSourceConversions = adMetrics
        ? Array.from(adMetrics.goalReaches.values()).reduce((s, n) => s + n, 0)
        : 0;

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
        adSourceVisits: adMetrics?.visits ?? 0,
        trafficSources,
        advertising: totals,
        balance,
        conversions: goals,
        campaigns,
        summary: {
          totalConversions,
          adSourceConversions,
          totalCost: totals.cost,
          costPerAdConversion:
            adSourceConversions > 0 && totals.cost > 0
              ? Math.round((totals.cost / adSourceConversions) * 100) / 100
              : null,
          activeCampaigns,
          bestCampaignByCtr: best
            ? { name: best.campaignName, ctr: best.ctr }
            : null,
          worstCampaignByCtr:
            worst && worst !== best
              ? { name: worst.campaignName, ctr: worst.ctr }
              : null,
          costIncludesVat: COST_INCLUDES_VAT,
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
  const cacheKey = `analytics:conversions:v3:${dateRange.dateFrom}:${dateRange.dateTo}`;

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

      const [rawGoals, rawCampaigns, traffic, adMetrics] = await Promise.all([
        metrika.getGoalConversions(dateRange.dateFrom, dateRange.dateTo),
        directFetch,
        metrika.getTrafficSummary(dateRange.dateFrom, dateRange.dateTo),
        safeAdSourceMetrics(metrika, dateRange.dateFrom, dateRange.dateTo),
      ]);

      const totalCost = rawCampaigns.reduce((sum, c) => sum + c.cost, 0);
      const adClicks = rawCampaigns.reduce((sum, c) => sum + c.clicks, 0);
      const goals = enrichGoals(rawGoals, adMetrics, totalCost);
      const totalReaches = goals.reduce((sum, g) => sum + g.reaches, 0);
      const adVisits = adMetrics?.visits ?? 0;
      const adConversions = adMetrics
        ? Array.from(adMetrics.goalReaches.values()).reduce((s, n) => s + n, 0)
        : 0;

      return {
        period: dateRange,
        goals,
        funnel: {
          adClicks,
          adVisits,
          adConversions,
          adConversionRate:
            adVisits > 0
              ? Math.round((adConversions / adVisits) * 10000) / 100
              : 0,
          totalVisits: traffic.visits,
          totalGoalReaches: totalReaches,
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
