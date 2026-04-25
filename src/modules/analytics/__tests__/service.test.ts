import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockMetrika, mockDirect } = vi.hoisted(() => ({
  mockMetrika: {
    getTrafficSummary: vi.fn(),
    getTrafficSources: vi.fn(),
    getGoalConversions: vi.fn(),
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

describe("resolveDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns custom range when both dates provided", () => {
    const result = resolveDateRange({ dateFrom: "2026-04-01", dateTo: "2026-04-10" });
    expect(result).toEqual({ dateFrom: "2026-04-01", dateTo: "2026-04-10" });
  });

  it("defaults to 7d period", () => {
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
});

describe("getOverview - cost attribution", () => {
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

  it("attributes cost to goals proportionally to their share of conversions", async () => {
    // Bug fix verification: previously, EACH goal showed the FULL totalCost as
    // costPerConversion. New behaviour distributes cost by share of reaches.
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
      { goalId: 1, goalName: "Бронирование", reaches: 8, conversionRate: 0.8 },
      { goalId: 2, goalName: "Звонок", reaches: 2, conversionRate: 0.2 },
    ]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.conversions).toHaveLength(2);
    expect(result.conversions[0].shareOfConversions).toBe(80);
    expect(result.conversions[1].shareOfConversions).toBe(20);
    expect(result.conversions[0].attributedCost).toBe(800);
    expect(result.conversions[1].attributedCost).toBe(200);

    // Verify summary has correct avgCostPerConversion (not inflated per-goal)
    expect(result.summary.totalConversions).toBe(10);
    expect(result.summary.avgCostPerConversion).toBe(100); // 1000 / 10
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

  it("handles zero campaigns gracefully (no division errors)", async () => {
    mockDirect.getCampaignStats.mockResolvedValue([]);
    mockMetrika.getGoalConversions.mockResolvedValue([
      { goalId: 1, goalName: "Бронирование", reaches: 5, conversionRate: 0.5 },
    ]);

    const result = await getOverview(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.advertising.cost).toBe(0);
    expect(result.advertising.ctr).toBe(0);
    expect(result.advertising.avgCpc).toBe(0);
    // No spend → avgCostPerConversion is 0₽ (organic), not null
    expect(result.summary.avgCostPerConversion).toBe(0);
    // No spend → no cost to attribute
    expect(result.conversions[0].attributedCost).toBeNull();
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

  it("computes funnel and proportional attributed cost", async () => {
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
      { goalId: 1, goalName: "Бронирование", reaches: 6, conversionRate: 0.6 },
      { goalId: 2, goalName: "Звонок", reaches: 4, conversionRate: 0.4 },
    ]);

    const result = await getConversions(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" },
      false
    );

    expect(result.funnel.totalVisits).toBe(1000);
    expect(result.funnel.totalGoalReaches).toBe(10);
    expect(result.funnel.overallConversionRate).toBe(1);
    expect(result.goals[0].attributedCost).toBe(360); // 600 * 0.6
    expect(result.goals[1].attributedCost).toBe(240); // 600 * 0.4
  });
});
