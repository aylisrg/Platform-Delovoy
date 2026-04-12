import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Redis
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue("OK"),
  },
  redisAvailable: true,
}));

// Mock Avito client
vi.mock("@/lib/avito", () => ({
  getAvitoItemStats: vi.fn(),
}));

// Mock Yandex client
vi.mock("@/lib/yandex", () => ({
  getYandexMarketingStats: vi.fn(),
}));

import { getGazebosMarketingStats } from "@/modules/gazebos/marketing-service";
import { getAvitoItemStats } from "@/lib/avito";
import { getYandexMarketingStats } from "@/lib/yandex";
import { redis } from "@/lib/redis";

const mockAvitoStats = {
  itemId: "12345",
  views: 450,
  uniqViews: 310,
  contacts: 28,
  favorites: 15,
  calls: 12,
  missedCalls: 3,
  dateFrom: "2026-03-13",
  dateTo: "2026-04-12",
  configured: true,
};

const mockYandexStats = {
  direct: {
    impressions: 1200,
    clicks: 85,
    cost: 3500,
    ctr: 7.08,
    configured: true,
  },
  metrika: {
    visits: 620,
    callsFromBusiness: 18,
    routesFromBusiness: 9,
    configured: true,
  },
  dateFrom: "2026-03-13",
  dateTo: "2026-04-12",
};

beforeEach(() => {
  vi.mocked(getAvitoItemStats).mockResolvedValue(mockAvitoStats);
  vi.mocked(getYandexMarketingStats).mockResolvedValue(mockYandexStats);
  vi.mocked(redis.get).mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getGazebosMarketingStats", () => {
  it("returns combined avito and yandex stats", async () => {
    const result = await getGazebosMarketingStats();

    expect(result.avito).toEqual(mockAvitoStats);
    expect(result.yandex).toEqual(mockYandexStats);
    expect(result.cachedAt).toBeTruthy();
  });

  it("fetches both sources in parallel", async () => {
    await getGazebosMarketingStats("2026-03-01", "2026-03-31");

    expect(getAvitoItemStats).toHaveBeenCalledWith("2026-03-01", "2026-03-31");
    expect(getYandexMarketingStats).toHaveBeenCalledWith("2026-03-01", "2026-03-31");
  });

  it("uses default date range (last 30 days) when not specified", async () => {
    await getGazebosMarketingStats();

    const avitoCall = vi.mocked(getAvitoItemStats).mock.calls[0];
    const [dateFrom, dateTo] = avitoCall;

    // dateTo should be today
    const today = new Date().toISOString().split("T")[0];
    expect(dateTo).toBe(today);

    // dateFrom should be ~30 days ago
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it("returns cached result when available in Redis", async () => {
    const cached = {
      avito: mockAvitoStats,
      yandex: mockYandexStats,
      cachedAt: "2026-04-12T10:00:00.000Z",
    };
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cached));

    const result = await getGazebosMarketingStats();

    expect(result.cachedAt).toBe("2026-04-12T10:00:00.000Z");
    // External APIs should NOT be called when cache hit
    expect(getAvitoItemStats).not.toHaveBeenCalled();
    expect(getYandexMarketingStats).not.toHaveBeenCalled();
  });

  it("writes result to Redis cache after fetching", async () => {
    await getGazebosMarketingStats("2026-03-01", "2026-03-31");

    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining("gazebos:marketing:stats"),
      600, // 10 min TTL
      expect.stringContaining('"configured":true')
    );
  });

  it("handles avito not configured gracefully", async () => {
    vi.mocked(getAvitoItemStats).mockResolvedValue({
      ...mockAvitoStats,
      configured: false,
      views: 0,
      calls: 0,
    });

    const result = await getGazebosMarketingStats();

    expect(result.avito.configured).toBe(false);
    expect(result.yandex.direct.configured).toBe(true);
  });

  it("handles yandex not configured gracefully", async () => {
    vi.mocked(getYandexMarketingStats).mockResolvedValue({
      ...mockYandexStats,
      direct: { impressions: 0, clicks: 0, cost: 0, ctr: 0, configured: false },
      metrika: { visits: 0, callsFromBusiness: 0, routesFromBusiness: 0, configured: false },
    });

    const result = await getGazebosMarketingStats();

    expect(result.yandex.direct.configured).toBe(false);
    expect(result.yandex.metrika.configured).toBe(false);
    expect(result.avito.configured).toBe(true);
  });

  it("handles both sources failing gracefully", async () => {
    vi.mocked(getAvitoItemStats).mockRejectedValue(new Error("network error"));
    vi.mocked(getYandexMarketingStats).mockRejectedValue(new Error("network error"));

    await expect(getGazebosMarketingStats()).rejects.toThrow();
  });
});
