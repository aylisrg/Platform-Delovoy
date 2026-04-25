import type { TrafficSummary, TrafficSource } from "./types";

export type RawGoalConversion = {
  goalId: number;
  goalName: string;
  reaches: number;
  conversionRate: number;
};

const METRIKA_STAT_URL = "https://api-metrika.yandex.net/stat/v1/data";
const METRIKA_MGMT_URL = "https://api-metrika.yandex.net/management/v1";
const REQUEST_TIMEOUT = 10_000;

type MetrikaStatResponse = {
  data: Array<{ metrics: number[]; dimensions?: Array<{ name: string }> }>;
  totals: number[];
  query: { metrics: string[] };
};

type MetrikaGoal = { id: number; name: string; type: string };

export class MetrikaClient {
  constructor(
    private readonly oauthToken: string,
    private readonly counterId: string
  ) {}

  private async request<T>(url: string, params?: Record<string, string>): Promise<T> {
    const searchParams = new URLSearchParams(params);
    const fullUrl = `${url}?${searchParams.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(fullUrl, {
        headers: { Authorization: `OAuth ${this.oauthToken}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`YANDEX_METRIKA_ERROR: ${res.status} ${text}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getTrafficSummary(dateFrom: string, dateTo: string): Promise<TrafficSummary> {
    const data = await this.request<MetrikaStatResponse>(METRIKA_STAT_URL, {
      ids: this.counterId,
      metrics:
        "ym:s:visits,ym:s:pageviews,ym:s:users,ym:s:bounceRate,ym:s:avgVisitDurationSeconds",
      date1: dateFrom,
      date2: dateTo,
    });

    const t = data.totals ?? [0, 0, 0, 0, 0];
    return {
      visits: Math.round(t[0] ?? 0),
      pageviews: Math.round(t[1] ?? 0),
      users: Math.round(t[2] ?? 0),
      bounceRate: Math.round((t[3] ?? 0) * 100) / 100,
      avgVisitDuration: Math.round((t[4] ?? 0) * 10) / 10,
    };
  }

  async getGoalConversions(dateFrom: string, dateTo: string): Promise<RawGoalConversion[]> {
    const goals = await this.getGoals();
    if (goals.length === 0) return [];

    const metricsArr = goals.flatMap((g) => [
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
    return goals.map((goal, i) => ({
      goalId: goal.id,
      goalName: goal.name,
      reaches: Math.round(totals[i * 2] ?? 0),
      conversionRate: Math.round((totals[i * 2 + 1] ?? 0) * 100) / 100,
    }));
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

  async getGoals(): Promise<Array<{ id: number; name: string }>> {
    const data = await this.request<{ goals: MetrikaGoal[] }>(
      `${METRIKA_MGMT_URL}/counter/${this.counterId}/goals`
    );
    return (data.goals ?? [])
      .filter((g) => g.type === "action")
      .map((g) => ({ id: g.id, name: g.name }));
  }
}
