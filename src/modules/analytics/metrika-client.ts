import { redis, redisAvailable } from "@/lib/redis";
import type { TrafficSummary, TrafficSource } from "./types";

export type RawGoalConversion = {
  goalId: number;
  goalName: string;
  goalType: string;
  reaches: number;
  conversionRate: number;
};

export type AdSourceMetrics = {
  visits: number;
  goalReaches: Map<number, number>;
};

const METRIKA_STAT_URL = "https://api-metrika.yandex.net/stat/v1/data";
const METRIKA_MGMT_URL = "https://api-metrika.yandex.net/management/v1";
const REQUEST_TIMEOUT = 10_000;

// `step` цели — композитные (агрегируют под-цели), их включение приводит к
// двойному учёту достижений. Все остальные типы (action, url, phone, file,
// number, payment_system, messenger, social, search, email) — независимы
// и должны попадать в сводку, как и в кабинете Метрики.
const COMPOSITE_GOAL_TYPES = new Set(["step"]);

// Фильтр для метрик Метрики, выделяющий только трафик из Яндекс.Директа.
// Использовать нужно `lastAdvEngine` — именно он хранит движок рекламы и
// принимает значение `ya_direct`. Старое `lastSourceEngine=='ya_direct'`
// отдаёт 400 (error code 4009: dimension does not support the value).
const AD_SOURCE_FILTER = "ym:s:lastAdvEngine=='ya_direct'";

// Метрика API ограничивает запрос 20 метриками за раз (error code 4015).
// На каждую цель уходит 2 метрики (reaches + conversionRate), значит максимум
// 10 целей за запрос для getGoalConversions, и 19 — для getAdSourceMetrics
// (где также шлётся `ym:s:visits`). Берём с запасом.
const METRIKA_METRICS_LIMIT = 20;

// Yandex enforces a per-UID parallel request quota (~5). This semaphore keeps
// all MetrikaClient instances on this process under 3 concurrent outbound calls.
const MAX_CONCURRENT = 3;
let _inFlight = 0;
const _waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (_inFlight < MAX_CONCURRENT) {
    _inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => _waitQueue.push(resolve));
}

function releaseSlot(): void {
  const next = _waitQueue.shift();
  if (next) {
    next();
  } else {
    _inFlight--;
  }
}

type MetrikaStatResponse = {
  data: Array<{ metrics: number[]; dimensions?: Array<{ name: string }> }>;
  totals: number[];
  query: { metrics: string[] };
};

type MetrikaGoal = { id: number; name: string; type: string };

export class MetrikaClient {
  private _goalsCache?: Promise<Array<{ id: number; name: string; type: string }>>;

  constructor(
    private readonly oauthToken: string,
    private readonly counterId: string
  ) {}

  private async request<T>(url: string, params?: Record<string, string>): Promise<T> {
    const searchParams = new URLSearchParams(params);
    const fullUrl = `${url}?${searchParams.toString()}`;

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await acquireSlot();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        let res: Response;
        try {
          res = await fetch(fullUrl, {
            headers: { Authorization: `OAuth ${this.oauthToken}` },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (res.status === 429 && attempt < maxAttempts) {
          await sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }

        if (res.status >= 500 && attempt < maxAttempts) {
          await sleep(500);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`YANDEX_METRIKA_ERROR: ${res.status} ${text}`);
        }

        return (await res.json()) as T;
      } finally {
        releaseSlot();
      }
    }

    // Unreachable, but satisfies TypeScript.
    throw new Error("YANDEX_METRIKA_ERROR: max retries exceeded");
  }

  async getTrafficSummary(dateFrom: string, dateTo: string): Promise<TrafficSummary> {
    const cacheKey = `metrika:traffic-summary:${this.counterId}:${dateFrom}:${dateTo}`;

    if (redisAvailable) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as TrafficSummary;
      } catch {
        // best-effort
      }
    }

    const data = await this.request<MetrikaStatResponse>(METRIKA_STAT_URL, {
      ids: this.counterId,
      metrics:
        "ym:s:visits,ym:s:pageviews,ym:s:users,ym:s:bounceRate,ym:s:avgVisitDurationSeconds",
      date1: dateFrom,
      date2: dateTo,
    });

    const t = data.totals ?? [0, 0, 0, 0, 0];
    const result: TrafficSummary = {
      visits: Math.round(t[0] ?? 0),
      pageviews: Math.round(t[1] ?? 0),
      users: Math.round(t[2] ?? 0),
      bounceRate: Math.round((t[3] ?? 0) * 100) / 100,
      avgVisitDuration: Math.round((t[4] ?? 0) * 10) / 10,
    };

    if (redisAvailable) {
      redis.setex(cacheKey, 300, JSON.stringify(result)).catch(() => {});
    }

    return result;
  }

  async getGoalConversions(dateFrom: string, dateTo: string): Promise<RawGoalConversion[]> {
    const goals = await this.getGoals();
    if (goals.length === 0) return [];

    // 2 метрики на цель — батч максимум 10 целей за запрос.
    const chunkSize = Math.floor(METRIKA_METRICS_LIMIT / 2);
    const result: RawGoalConversion[] = [];

    for (let i = 0; i < goals.length; i += chunkSize) {
      const chunk = goals.slice(i, i + chunkSize);
      const metricsArr = chunk.flatMap((g) => [
        `ym:s:goal${g.id}reaches`,
        `ym:s:goal${g.id}conversionRate`,
      ]);

      const data = await this.request<MetrikaStatResponse>(METRIKA_STAT_URL, {
        ids: this.counterId,
        metrics: metricsArr.join(","),
        date1: dateFrom,
        date2: dateTo,
      });

      const totals = data.totals ?? [];
      chunk.forEach((goal, j) => {
        result.push({
          goalId: goal.id,
          goalName: goal.name,
          goalType: goal.type,
          reaches: Math.round(totals[j * 2] ?? 0),
          conversionRate: Math.round((totals[j * 2 + 1] ?? 0) * 100) / 100,
        });
      });
    }

    return result;
  }

  /**
   * Визиты и достижения целей ИЗ ЯНДЕКС.ДИРЕКТА (lastSourceEngine == ya_direct).
   * Используется чтобы корректно посчитать стоимость рекламной конверсии
   * и не смешивать органику с платным трафиком.
   */
  async getAdSourceMetrics(dateFrom: string, dateTo: string): Promise<AdSourceMetrics> {
    const goals = await this.getGoals();
    const goalReaches = new Map<number, number>();

    // Первый запрос: visits + первые (LIMIT-1) целей.
    // Последующие батчи: только метрики reach по целям.
    const firstChunkSize = METRIKA_METRICS_LIMIT - 1;
    const firstChunk = goals.slice(0, firstChunkSize);
    const restChunkSize = METRIKA_METRICS_LIMIT;

    const firstMetrics = [
      "ym:s:visits",
      ...firstChunk.map((g) => `ym:s:goal${g.id}reaches`),
    ];
    const firstData = await this.request<MetrikaStatResponse>(METRIKA_STAT_URL, {
      ids: this.counterId,
      metrics: firstMetrics.join(","),
      filters: AD_SOURCE_FILTER,
      date1: dateFrom,
      date2: dateTo,
    });
    const firstTotals = firstData.totals ?? [];
    const visits = Math.round(firstTotals[0] ?? 0);
    firstChunk.forEach((goal, i) => {
      goalReaches.set(goal.id, Math.round(firstTotals[i + 1] ?? 0));
    });

    for (let i = firstChunkSize; i < goals.length; i += restChunkSize) {
      const chunk = goals.slice(i, i + restChunkSize);
      const metrics = chunk.map((g) => `ym:s:goal${g.id}reaches`);
      const data = await this.request<MetrikaStatResponse>(METRIKA_STAT_URL, {
        ids: this.counterId,
        metrics: metrics.join(","),
        filters: AD_SOURCE_FILTER,
        date1: dateFrom,
        date2: dateTo,
      });
      const totals = data.totals ?? [];
      chunk.forEach((goal, j) => {
        goalReaches.set(goal.id, Math.round(totals[j] ?? 0));
      });
    }

    return { visits, goalReaches };
  }

  async getTrafficSources(dateFrom: string, dateTo: string): Promise<TrafficSource[]> {
    const data = await this.request<MetrikaStatResponse>(METRIKA_STAT_URL, {
      ids: this.counterId,
      metrics: "ym:s:visits",
      dimensions: "ym:s:lastTrafficSource",
      date1: dateFrom,
      date2: dateTo,
      sort: "-ym:s:visits",
      limit: "10",
    });

    const totalVisits = data.totals?.[0] ?? 0;
    return (data.data ?? []).map((row) => ({
      source: row.dimensions?.[0]?.name ?? "unknown",
      visits: Math.round(row.metrics[0] ?? 0),
      percentage:
        totalVisits > 0
          ? Math.round(((row.metrics[0] ?? 0) / totalVisits) * 10000) / 100
          : 0,
    }));
  }

  async getGoals(): Promise<Array<{ id: number; name: string; type: string }>> {
    // Dedupe concurrent calls within one instance lifetime.
    if (this._goalsCache) return this._goalsCache;

    this._goalsCache = (async () => {
      const cacheKey = `metrika:goals:${this.counterId}`;

      if (redisAvailable) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return JSON.parse(cached) as Array<MetrikaGoal>;
        } catch {
          // best-effort
        }
      }

      const data = await this.request<{ goals: MetrikaGoal[] }>(
        `${METRIKA_MGMT_URL}/counter/${this.counterId}/goals`
      );
      const goals = (data.goals ?? [])
        .filter((g) => !COMPOSITE_GOAL_TYPES.has(g.type))
        .map((g) => ({ id: g.id, name: g.name, type: g.type }));

      if (redisAvailable) {
        redis.setex(cacheKey, 3600, JSON.stringify(goals)).catch(() => {});
      }

      return goals;
    })();

    return this._goalsCache;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
