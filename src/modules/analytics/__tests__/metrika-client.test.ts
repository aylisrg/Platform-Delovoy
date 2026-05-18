import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetrikaClient } from "../metrika-client";

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue("OK") },
  redisAvailable: false,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("MetrikaClient", () => {
  let client: MetrikaClient;

  beforeEach(() => {
    client = new MetrikaClient("test-token", "73068007");
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("includes non-step goal types (url, phone, action) — composite 'step' excluded", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        goals: [
          { id: 1, name: "Бронирование беседки", type: "action" },
          { id: 2, name: "Страница спасибо", type: "url" },
          { id: 3, name: "Клик на телефон", type: "phone" },
          { id: 4, name: "Композитный шаг", type: "step" },
        ],
      }),
    });

    const result = await client.getGoals();
    expect(result).toHaveLength(3);
    expect(result.map((g) => g.type)).toEqual(["action", "url", "phone"]);
    expect(result.find((g) => g.id === 4)).toBeUndefined();
  });

  it("returns raw goal conversions including goalType", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          goals: [
            { id: 10, name: "Бронирование", type: "action" },
            { id: 11, name: "Заявка на офис", type: "url" },
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
      { goalId: 10, goalName: "Бронирование", goalType: "action", reaches: 42, conversionRate: 3.5 },
      { goalId: 11, goalName: "Заявка на офис", goalType: "url", reaches: 15, conversionRate: 1.2 },
    ]);
  });

  it("getAdSourceMetrics returns visits + per-goal reaches filtered by ya_direct", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          goals: [
            { id: 10, name: "Бронирование", type: "action" },
            { id: 11, name: "Заявка", type: "url" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          // [visits, goal10, goal11]
          totals: [120, 8, 3],
          data: [],
          query: { metrics: [] },
        }),
      });

    const result = await client.getAdSourceMetrics("2026-04-01", "2026-04-15");
    expect(result.visits).toBe(120);
    expect(result.goalReaches.get(10)).toBe(8);
    expect(result.goalReaches.get(11)).toBe(3);

    // Verify the filter was passed
    const lastCallUrl = mockFetch.mock.calls[1][0] as string;
    expect(lastCallUrl).toContain("filters=");
    expect(decodeURIComponent(lastCallUrl)).toContain("lastAdvEngine=='ya_direct'");
  });

  it("batches getGoalConversions when >10 goals (Metrika 20-metrics limit)", async () => {
    const goals = Array.from({ length: 17 }, (_, i) => ({
      id: 100 + i,
      name: `Цель ${i}`,
      type: "action",
    }));
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ goals }),
      })
      // First batch: 10 goals → 20 metric values
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totals: Array.from({ length: 20 }, (_, i) => i + 1),
          data: [],
          query: { metrics: [] },
        }),
      })
      // Second batch: 7 goals → 14 metric values
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totals: Array.from({ length: 14 }, (_, i) => 100 + i),
          data: [],
          query: { metrics: [] },
        }),
      });

    const result = await client.getGoalConversions("2026-04-01", "2026-04-15");
    expect(result).toHaveLength(17);
    // Each batch URL must have ≤20 metrics (no 4015 error)
    const batchUrls = mockFetch.mock.calls.slice(1).map((c) => c[0] as string);
    for (const url of batchUrls) {
      const m = decodeURIComponent(url).match(/metrics=([^&]+)/)?.[1] ?? "";
      expect(m.split(",").length).toBeLessThanOrEqual(20);
    }
    // Sanity on first goal
    expect(result[0]).toMatchObject({ goalId: 100, reaches: 1, conversionRate: 2 });
    // First goal of second batch (goal 110): totals[0]=100 (reaches), totals[1]=1.01 (conversionRate, /100)
    expect(result[10].goalId).toBe(110);
    expect(result[10].reaches).toBe(100);
  });

  it("batches getAdSourceMetrics when >19 goals", async () => {
    const goals = Array.from({ length: 25 }, (_, i) => ({
      id: 200 + i,
      name: `Цель ${i}`,
      type: "action",
    }));
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ goals }) })
      // First call: visits + 19 goals = 20 metrics
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totals: [555, ...Array.from({ length: 19 }, () => 1)],
          data: [],
          query: { metrics: [] },
        }),
      })
      // Second call: remaining 6 goals
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totals: Array.from({ length: 6 }, () => 2),
          data: [],
          query: { metrics: [] },
        }),
      });

    const result = await client.getAdSourceMetrics("2026-04-01", "2026-04-15");
    expect(result.visits).toBe(555);
    expect(result.goalReaches.size).toBe(25);
    expect(result.goalReaches.get(200)).toBe(1);
    expect(result.goalReaches.get(224)).toBe(2);

    const batchUrls = mockFetch.mock.calls.slice(1).map((c) => c[0] as string);
    for (const url of batchUrls) {
      const m = decodeURIComponent(url).match(/metrics=([^&]+)/)?.[1] ?? "";
      expect(m.split(",").length).toBeLessThanOrEqual(20);
    }
  });

  it("throws on non-retryable API error", async () => {
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

  // --- New: semaphore, retry, goals dedup ---

  it("limits concurrent outbound requests to 3", async () => {
    let inFlight = 0;
    let maxSeen = 0;

    mockFetch.mockImplementation(async () => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      // Yield so other queued requests can run while this one is "in flight".
      await new Promise<void>((r) => setTimeout(r, 0));
      inFlight--;
      return { ok: true, json: async () => ({ totals: [0, 0, 0, 0, 0], data: [], query: { metrics: [] } }) };
    });

    const requests = Array.from({ length: 10 }, () =>
      client.getTrafficSummary("2026-01-01", "2026-01-31")
    );
    await Promise.all(requests);

    expect(maxSeen).toBeLessThanOrEqual(3);
    expect(mockFetch).toHaveBeenCalledTimes(10);
  });

  it("retries once on 429 and returns the successful response", async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ totals: [5, 10, 3, 20, 90], data: [], query: { metrics: [] } }),
      });

    const promise = client.getTrafficSummary("2026-01-01", "2026-01-31");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.visits).toBe(5);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws YANDEX_METRIKA_ERROR after exhausting all 429 retries", async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => '{"code":429}' });

    const promise = client.getTrafficSummary("2026-01-01", "2026-01-31");
    // Attach rejection handler before advancing timers to avoid unhandled-rejection warning.
    const assertion = expect(promise).rejects.toThrow("YANDEX_METRIKA_ERROR: 429");
    await vi.runAllTimersAsync();
    await assertion;

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("deduplicates concurrent getGoals() calls — fetch invoked once per instance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        goals: [{ id: 1, name: "Цель A", type: "action" }],
      }),
    });

    const [r1, r2] = await Promise.all([client.getGoals(), client.getGoals()]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);
  });
});
