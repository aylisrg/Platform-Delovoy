import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockMetrika, mockDirect } = vi.hoisted(() => ({
  mockMetrika: {
    getTrafficSummary: vi.fn(),
    getTrafficSources: vi.fn(),
    getGoalConversions: vi.fn(),
    getAdSourceMetrics: vi.fn(),
  },
  mockDirect: {
    getCampaignStats: vi.fn(),
    getAccountBalance: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
  redisAvailable: false,
}));

vi.mock("../metrika-client", () => ({
  MetrikaClient: class {
    constructor() {
      return mockMetrika;
    }
  },
}));

vi.mock("../direct-client", () => ({
  DirectClient: class {
    constructor() {
      return mockDirect;
    }
  },
}));

import { resolveDateRange, getOverview, getCampaigns, getConversions } from "../service";

// Helper: build a goal-reaches map from {id: count} object
function reachesMap(o: Record<number, number>): Map<number, number> {
  return new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
}

describe("resolveDateRange (Moscow TZ)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Noon UTC = 15:00 Moscow → safely the same Moscow date
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns custom range when both dates provided", () => {
    const result = resolveDateRange({ dateFrom: "2026-04-01", dateTo: "2026-04-10" });
    expect(result).toEqual({ dateFrom: "2026-04-01", dateTo: "2026-04-10" });
  });

  it("defaults to 7d period anchored to Moscow today", () => {
    const result = resolveDateRange({});
    expect(result.dateTo).toBe("2026-04-15");
    expect(result.dateFrom).toBe("2026-04-09");
  });

  it("resolves today period", () => {
    const result = resolveDateRange({ period: "today" });
    expect(result.dateFrom).toBe("2026-04-15");
    expect(result.dateTo).toBe("2026-04-15");
  });

  it("resolves 30d period", () => {
    const result = resolveDateRange({ period: "30d" });
    expect(result.dateTo).toBe("2026-04-15");
    expect(result.dateFrom).toBe("2026-03-17");
  });

  it("crosses Moscow midnight correctly: at 23:30 UTC (02:30 Moscow next day) period rolls forward", () => {
    // 2026-04-15 23:30 UTC = 2026-04-16 02:30 Moscow
    vi.setSystemTime(new Date("2026-04-15T23:30:00Z"));
    const today = resolveDateRange({ period: "today" });
    expect(today.dateFrom).toBe("2026-04-16"); // Moscow date, NOT UTC
    expect(today.dateTo).toBe("2026-04-16");
  });
});

describe("getOverview - cost attribution by ad source", () => {
  beforeEach(() => {
    process.env.YANDEX_OAUTH_TOKEN = "test-token";
    process.env.YANDEX_DIRECT_CLIENT_LOGIN = "test-login";
    process.env.YANDEX_METRIKA_COUNTER_ID = "12345";
    delete process.env.YANDEX_DIRECT_BALANCE_MANUAL;
    vi.clearAllMocks();

    mockMetrika.getTrafficSummary.mockResolvedValue({
      visits: 1000,
      pageviews: 3000,
      users: 800,
      bounceRate: 25,
      avgVisitDuration: 120,
    });
    mockMetrika.getTrafficSources.mockResolvedValue([
      { source: "ad", visits: 600, percentage: 60 },
      { source: "organic", visits: 400, percentage: 40 },
    ]);
    mockMetrika.getAdSourceMetrics.mockResolvedValue({
      visits: 0,
      goalReaches: new Map(),
    });
    mockDirect.getAccountBalance.mockResolvedValue({
      amount: 5000,
      currency: "RUB",
      source: "manual_env",
      message: null,
    });
  });

  it("computes cost share per campaign and totals correctly", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "Беседки",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 50,
        ctr: 5,
        cost: 1500,
        avgCpc: 30,
        costShare: 0,
      },
      {
        campaignId: 2,
        campaignName: "Офисы",
        status: "ACCEPTED",
        impressions: 500,
        clicks: 20,
        ctr: 4,
        cost: 500,
        avgCpc: 25,
        costShare: 0,
      },
    ]);
    mockMetrika.getGoalConversions.mockResolvedValue([]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.advertising.cost).toBe(2000);
    expect(result.advertising.impressions).toBe(1500);
    expect(result.advertising.clicks).toBe(70);
    expect(result.campaigns[0].costShare).toBe(75);
    expect(result.campaigns[1].costShare).toBe(25);
    expect(result.summary.activeCampaigns).toBe(2);
  });

  it("costPerAdConversion uses ad-source conversions only — not all-source conversions", async () => {
    // Bug fix: previously avgCostPerConversion was totalCost / totalConversions
    // (mixing organic with ads). Now it's totalCost / adSourceConversions only.
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "Кампания",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 100,
        ctr: 10,
        cost: 6000,
        avgCpc: 60,
        costShare: 0,
      },
    ]);
    // 50 total goal reaches across all sources
    mockMetrika.getGoalConversions.mockResolvedValue([
      { goalId: 1, goalName: "Бронирование", goalType: "action", reaches: 30, conversionRate: 3 },
      { goalId: 2, goalName: "Звонок", goalType: "phone", reaches: 20, conversionRate: 2 },
    ]);
    // But only 8 came from ads (rest is organic)
    mockMetrika.getAdSourceMetrics.mockResolvedValue({
      visits: 80,
      goalReaches: reachesMap({ 1: 6, 2: 2 }),
    });

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    // Old wrong calc: 6000 / 50 = 120₽
    // New correct calc: 6000 / 8 = 750₽
    expect(result.summary.costPerAdConversion).toBe(750);
    expect(result.summary.totalConversions).toBe(50);
    expect(result.summary.adSourceConversions).toBe(8);
    expect(result.adSourceVisits).toBe(80);
  });

  it("attributes cost per goal proportionally to AD-source reaches (not all reaches)", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "Кампания",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 100,
        ctr: 10,
        cost: 1000,
        avgCpc: 10,
        costShare: 0,
      },
    ]);
    mockMetrika.getGoalConversions.mockResolvedValue([
      { goalId: 1, goalName: "Бронирование", goalType: "action", reaches: 30, conversionRate: 3 },
      { goalId: 2, goalName: "Звонок", goalType: "phone", reaches: 20, conversionRate: 2 },
    ]);
    // Из 10 рекламных конверсий: 8 на бронирование, 2 на звонок
    mockMetrika.getAdSourceMetrics.mockResolvedValue({
      visits: 100,
      goalReaches: reachesMap({ 1: 8, 2: 2 }),
    });

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.conversions).toHaveLength(2);
    // Distributed by AD-source share: 8/10 and 2/10
    expect(result.conversions[0].attributedCost).toBe(800);
    expect(result.conversions[1].attributedCost).toBe(200);
    // CPA per goal = totalCost / total ad reaches = 1000/10 = 100 (same for both, by design)
    expect(result.conversions[0].costPerAdConversion).toBe(100);
    expect(result.conversions[1].costPerAdConversion).toBe(100);
    expect(result.conversions[0].reachesFromAds).toBe(8);
    expect(result.conversions[1].reachesFromAds).toBe(2);
  });

  it("identifies best and worst campaigns by CTR", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "A",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 100,
        ctr: 10,
        cost: 100,
        avgCpc: 1,
        costShare: 0,
      },
      {
        campaignId: 2,
        campaignName: "B",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 50,
        ctr: 5,
        cost: 50,
        avgCpc: 1,
        costShare: 0,
      },
      {
        campaignId: 3,
        campaignName: "C",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 20,
        ctr: 2,
        cost: 20,
        avgCpc: 1,
        costShare: 0,
      },
    ]);
    mockMetrika.getGoalConversions.mockResolvedValue([]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.summary.bestCampaignByCtr).toEqual({ name: "A", ctr: 10 });
    expect(result.summary.worstCampaignByCtr).toEqual({ name: "C", ctr: 2 });
  });

  it("includes balance in overview response", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([]);
    mockMetrika.getGoalConversions.mockResolvedValue([]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.balance.amount).toBe(5000);
    expect(result.balance.source).toBe("manual_env");
  });

  it("includes traffic sources", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([]);
    mockMetrika.getGoalConversions.mockResolvedValue([]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.trafficSources).toHaveLength(2);
    expect(result.trafficSources[0].source).toBe("ad");
  });

  it("when no ad-source conversions, costPerAdConversion is null and goal attribution is null", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "Кампания",
        status: "ACCEPTED",
        impressions: 100,
        clicks: 10,
        ctr: 10,
        cost: 1000,
        avgCpc: 100,
        costShare: 0,
      },
    ]);
    mockMetrika.getGoalConversions.mockResolvedValue([
      { goalId: 1, goalName: "Бронирование", goalType: "action", reaches: 5, conversionRate: 0.5 },
    ]);
    mockMetrika.getAdSourceMetrics.mockResolvedValue({
      visits: 10,
      goalReaches: reachesMap({ 1: 0 }),
    });

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.summary.adSourceConversions).toBe(0);
    expect(result.summary.costPerAdConversion).toBeNull();
    expect(result.conversions[0].attributedCost).toBeNull();
    expect(result.conversions[0].costPerAdConversion).toBeNull();
  });

  it("survives ad-source query failure (degrades to no ad attribution)", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([]);
    mockMetrika.getGoalConversions.mockResolvedValue([
      { goalId: 1, goalName: "Бронирование", goalType: "action", reaches: 5, conversionRate: 0.5 },
    ]);
    mockMetrika.getAdSourceMetrics.mockRejectedValue(new Error("Metrika 500"));

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.summary.adSourceConversions).toBe(0);
    expect(result.adSourceVisits).toBe(0);
    expect(result.conversions[0].reachesFromAds).toBe(0);
  });

  it("exposes costIncludesVat flag in summary", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([]);
    mockMetrika.getGoalConversions.mockResolvedValue([]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.summary.costIncludesVat).toBe(true);
  });
});

describe("getCampaigns", () => {
  beforeEach(() => {
    process.env.YANDEX_OAUTH_TOKEN = "test-token";
    process.env.YANDEX_DIRECT_CLIENT_LOGIN = "test-login";
    vi.clearAllMocks();
  });

  it("sorts campaigns by cost descending and computes shares", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "Cheap",
        status: "ACCEPTED",
        impressions: 100,
        clicks: 5,
        ctr: 5,
        cost: 100,
        avgCpc: 20,
        costShare: 0,
      },
      {
        campaignId: 2,
        campaignName: "Big",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 50,
        ctr: 5,
        cost: 900,
        avgCpc: 18,
        costShare: 0,
      },
    ]);

    const result = await getCampaigns(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.campaigns[0].campaignName).toBe("Big");
    expect(result.campaigns[0].costShare).toBe(90);
    expect(result.campaigns[1].costShare).toBe(10);
    expect(result.totals.cost).toBe(1000);
  });
});

describe("getConversions", () => {
  beforeEach(() => {
    process.env.YANDEX_OAUTH_TOKEN = "test-token";
    process.env.YANDEX_DIRECT_CLIENT_LOGIN = "test-login";
    vi.clearAllMocks();

    mockMetrika.getTrafficSummary.mockResolvedValue({
      visits: 1000,
      pageviews: 3000,
      users: 800,
      bounceRate: 25,
      avgVisitDuration: 120,
    });
  });

  it("computes ad-source funnel: clicks → ad visits → ad conversions", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([
      {
        campaignId: 1,
        campaignName: "A",
        status: "ACCEPTED",
        impressions: 1000,
        clicks: 100,
        ctr: 10,
        cost: 600,
        avgCpc: 6,
        costShare: 0,
      },
    ]);
    mockMetrika.getGoalConversions.mockResolvedValue([
      { goalId: 1, goalName: "Бронирование", goalType: "action", reaches: 30, conversionRate: 3 },
      { goalId: 2, goalName: "Звонок", goalType: "phone", reaches: 20, conversionRate: 2 },
    ]);
    mockMetrika.getAdSourceMetrics.mockResolvedValue({
      visits: 80,
      goalReaches: reachesMap({ 1: 6, 2: 4 }),
    });

    const result = await getConversions(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.funnel.adClicks).toBe(100);
    expect(result.funnel.adVisits).toBe(80);
    expect(result.funnel.adConversions).toBe(10);
    expect(result.funnel.adConversionRate).toBe(12.5); // 10 / 80 * 100
    // Context numbers (all sources) preserved
    expect(result.funnel.totalVisits).toBe(1000);
    expect(result.funnel.totalGoalReaches).toBe(50);
    // Per-goal ad reaches surfaced
    expect(result.goals[0].reachesFromAds).toBe(6);
    expect(result.goals[1].reachesFromAds).toBe(4);
  });
});
