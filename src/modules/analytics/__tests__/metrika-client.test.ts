import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetrikaClient } from "../metrika-client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("MetrikaClient", () => {
  let client: MetrikaClient;

  beforeEach(() => {
    client = new MetrikaClient("test-token", "73068007");
    mockFetch.mockReset();
  });

  it("fetches traffic summary", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totals: [1245, 3891, 876, 32.5, 185.3],
        data: [],
        query: { metrics: [] },
      }),
    });

    const result = await client.getTrafficSummary("2026-04-01", "2026-04-15");

    expect(result).toEqual({
      visits: 1245,
      pageviews: 3891,
      users: 876,
      bounceRate: 32.5,
      avgVisitDuration: 185.3,
    });
  });

  it("fetches goals list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        goals: [
          { id: 1, name: "Бронирование беседки", type: "action" },
          { id: 2, name: "Page visit", type: "url" },
        ],
      }),
    });

    const result = await client.getGoals();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 1, name: "Бронирование беседки" });
  });

  it("returns raw goal conversions without cost (cost attribution lives in service)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          goals: [
            { id: 10, name: "Бронирование", type: "action" },
            { id: 11, name: "Заявка на офис", type: "action" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totals: [42, 3.5, 15, 1.2],
          data: [],
          query: { metrics: [] },
        }),
      });

    const result = await client.getGoalConversions("2026-04-01", "2026-04-15");
    expect(result).toEqual([
      { goalId: 10, goalName: "Бронирование", reaches: 42, conversionRate: 3.5 },
      { goalId: 11, goalName: "Заявка на офис", reaches: 15, conversionRate: 1.2 },
    ]);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Unauthorized",
    });

    await expect(
      client.getTrafficSummary("2026-04-01", "2026-04-15")
    ).rejects.toThrow("YANDEX_METRIKA_ERROR");
  });

  it("fetches traffic sources", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totals: [100],
        data: [
          { dimensions: [{ name: "ad" }], metrics: [60] },
          { dimensions: [{ name: "organic" }], metrics: [30] },
          { dimensions: [{ name: "direct" }], metrics: [10] },
        ],
        query: {},
      }),
    });

    const result = await client.getTrafficSources("2026-04-01", "2026-04-15");
    expect(result).toHaveLength(3);
    expect(result[0].source).toBe("ad");
    expect(result[0].percentage).toBe(60);
  });
});
