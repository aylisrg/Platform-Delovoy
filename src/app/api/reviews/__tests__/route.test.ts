import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing route
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
  },
  redisAvailable: true,
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@landing/lib/parsers/yandex-reviews", () => ({
  parseYandexReviews: vi.fn(),
}));

vi.mock("@/lib/api-response", () => ({
  apiResponse: vi.fn((data) => ({
    status: 200,
    _body: { success: true, data },
    async json() {
      return { success: true, data };
    },
  })),
  apiError: vi.fn((code, message, status = 400) => ({
    status,
    _body: { success: false, error: { code, message } },
    async json() {
      return { success: false, error: { code, message } };
    },
  })),
}));

import { GET } from "../route";
import { redis } from "@/lib/redis";
import { parseYandexReviews } from "@landing/lib/parsers/yandex-reviews";
import { log } from "@/lib/logger";
import type { Review, ReviewsCache } from "@landing/lib/parsers/types";

const mockReview: Review = {
  id: "yandex-abc123",
  author: "Test User",
  rating: 5,
  text: "Great business park!",
  date: "2 месяца назад",
  source: "yandex",
};

describe("GET /api/reviews", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.YANDEX_MAPS_URL = "https://yandex.ru/maps/org/test/123";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached reviews when available", async () => {
    const cachedData: ReviewsCache = {
      fetchedAt: Date.now(),
      reviews: [mockReview],
    };

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify(cachedData)
    );

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    expect(redis.get).toHaveBeenCalledWith("reviews:yandex");
    expect(parseYandexReviews).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      "reviews-api",
      "Returning cached reviews",
      expect.any(Object)
    );

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockReview]);
  });

  it("parses fresh reviews when cache is empty", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      mockReview,
    ]);

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    expect(redis.get).toHaveBeenCalledWith("reviews:yandex");
    expect(parseYandexReviews).toHaveBeenCalledWith(
      "https://yandex.ru/maps/org/test/123"
    );
    expect(redis.setex).toHaveBeenCalledWith(
      "reviews:yandex",
      3600,
      expect.stringContaining(mockReview.id)
    );

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockReview]);
  });

  it("bypasses cache when refresh=1 query param is present", async () => {
    const cachedData: ReviewsCache = {
      fetchedAt: Date.now() - 100000,
      reviews: [mockReview],
    };

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify(cachedData)
    );
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...mockReview, id: "yandex-new123" },
    ]);

    const request = new Request("http://localhost:3000/api/reviews?refresh=1");
    const response = await GET(request);

    expect(redis.get).not.toHaveBeenCalled();
    expect(parseYandexReviews).toHaveBeenCalled();

    const body = await response.json();
    expect(body.data[0].id).toBe("yandex-new123");
  });

  it("returns empty array when YANDEX_MAPS_URL is not configured", async () => {
    delete process.env.YANDEX_MAPS_URL;
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("handles cache read errors gracefully", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Redis connection failed")
    );
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      mockReview,
    ]);

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    // Should still return reviews despite cache read failure
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockReview]);
  });

  it("handles cache write errors gracefully", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      mockReview,
    ]);
    (redis.setex as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Redis write failed")
    );

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    expect(log.warn).toHaveBeenCalledWith(
      "reviews-api",
      "Failed to save to cache",
      expect.any(Object)
    );

    // Should still return reviews despite cache write failure
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockReview]);
  });

  it("does not cache empty reviews array", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    expect(redis.setex).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("handles unexpected errors gracefully", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unexpected error")
    );
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Parse error")
    );

    const request = new Request("http://localhost:3000/api/reviews");
    const response = await GET(request);

    expect(log.error).toHaveBeenCalledWith(
      "reviews-api",
      "Unexpected error in reviews endpoint",
      expect.any(Object)
    );

    // Graceful degradation: return empty array
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("saves reviews to cache with correct TTL", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      mockReview,
    ]);

    const request = new Request("http://localhost:3000/api/reviews");
    await GET(request);

    expect(redis.setex).toHaveBeenCalledWith(
      "reviews:yandex",
      3600, // 1 hour TTL
      expect.any(String)
    );

    // Verify cached data structure
    const cachedDataString = (redis.setex as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    const cachedData = JSON.parse(cachedDataString);
    expect(cachedData).toHaveProperty("fetchedAt");
    expect(cachedData).toHaveProperty("reviews");
    expect(cachedData.reviews).toEqual([mockReview]);
  });

  it("logs successful cache save", async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (parseYandexReviews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      mockReview,
    ]);

    const request = new Request("http://localhost:3000/api/reviews");
    await GET(request);

    expect(log.info).toHaveBeenCalledWith(
      "reviews-api",
      "Saved reviews to cache",
      {
        count: 1,
        ttl: 3600,
      }
    );
  });
});
