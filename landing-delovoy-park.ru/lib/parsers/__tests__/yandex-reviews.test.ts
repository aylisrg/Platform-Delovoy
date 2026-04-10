import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger before importing parser
vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { parseYandexReviews } from "../yandex-reviews";
import { log } from "@/lib/logger";

describe("parseYandexReviews", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty reviews when fetch fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews).toEqual([]);
    expect(result.meta).toBeDefined();
    expect(log.warn).toHaveBeenCalledWith(
      "reviews-parser",
      expect.stringContaining("Failed to fetch"),
      expect.any(Object)
    );
  });

  it("returns empty reviews when no review elements found", async () => {
    const html = "<html><body><div>No reviews here</div></body></html>";

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews).toEqual([]);
    expect(result.meta).toBeDefined();
    expect(log.warn).toHaveBeenCalledWith(
      "reviews-parser",
      "No review elements found on page",
      expect.any(Object)
    );
  });

  it("parses reviews from HTML successfully", async () => {
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-review-author">Иван Петров</div>
            <div class="business-rating" aria-label="Рейтинг 5">★★★★★</div>
            <div class="business-review-body">Отличный бизнес-парк!</div>
            <div class="business-review-date">2 месяца назад</div>
          </div>
          <div class="business-review-card">
            <div class="business-review-author">Мария С.</div>
            <div class="business-rating" aria-label="Рейтинг 5">★★★★★</div>
            <div class="business-review-body">Рекомендую!</div>
            <div class="business-review-date">3 месяца назад</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({
      author: "Иван Петров",
      rating: 5,
      text: "Отличный бизнес-парк!",
      date: "2 месяца назад",
      source: "yandex",
    });
    expect(result.reviews[0].id).toBeTruthy();
    expect(result.meta).toBeDefined();
    expect(log.info).toHaveBeenCalledWith(
      "reviews-parser",
      expect.stringContaining("Successfully parsed"),
      expect.any(Object)
    );
  });

  it("limits to maximum 15 reviews", async () => {
    const reviewHtml = (index: number) => `
      <div class="business-review-card">
        <div class="business-review-author">User ${index}</div>
        <div class="business-rating">★★★★★</div>
        <div class="business-review-body">Review ${index}</div>
        <div class="business-review-date">1 день назад</div>
      </div>
    `;

    const html = `
      <html><body>
        ${Array.from({ length: 20 }, (_, i) => reviewHtml(i + 1)).join("")}
      </body></html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews.length).toBeLessThanOrEqual(15);
  });

  it("truncates review text to 1000 characters", async () => {
    const longText = "A".repeat(1500);
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-review-author">Test User</div>
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body">${longText}</div>
            <div class="business-review-date">сегодня</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews[0].text).toHaveLength(1000);
  });

  it("skips reviews without text", async () => {
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-review-author">User 1</div>
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body"></div>
            <div class="business-review-date">сегодня</div>
          </div>
          <div class="business-review-card">
            <div class="business-review-author">User 2</div>
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body">Valid review</div>
            <div class="business-review-date">вчера</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].author).toBe("User 2");
  });

  it("clamps rating to 1-5 range", async () => {
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-review-author">User</div>
            <div class="business-rating" aria-label="Рейтинг 10">★★★★★</div>
            <div class="business-review-body">Test review</div>
            <div class="business-review-date">сегодня</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews[0].rating).toBe(5);
    expect(result.reviews[0].rating).toBeGreaterThanOrEqual(1);
    expect(result.reviews[0].rating).toBeLessThanOrEqual(5);
  });

  it("handles fetch exception gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews).toEqual([]);
    expect(result.meta).toBeDefined();
    expect(log.error).toHaveBeenCalledWith(
      "reviews-parser",
      "Failed to parse Yandex Maps reviews",
      expect.any(Object)
    );
  });

  it("uses default author name when not found", async () => {
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body">Anonymous review</div>
            <div class="business-review-date">сегодня</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews[0].author).toBe("Аноним");
  });

  it("uses default date when not found", async () => {
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-review-author">User</div>
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body">Review text</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews[0].date).toBe("недавно");
  });

  it("generates unique IDs for different reviews", async () => {
    const html = `
      <html>
        <body>
          <div class="business-review-card">
            <div class="business-review-author">User 1</div>
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body">Review 1</div>
            <div class="business-review-date">сегодня</div>
          </div>
          <div class="business-review-card">
            <div class="business-review-author">User 2</div>
            <div class="business-rating">★★★★★</div>
            <div class="business-review-body">Review 2</div>
            <div class="business-review-date">вчера</div>
          </div>
        </body>
      </html>
    `;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
    });

    const result = await parseYandexReviews("https://example.com");

    expect(result.reviews[0].id).not.toBe(result.reviews[1].id);
    expect(result.reviews[0].id).toContain("yandex-");
    expect(result.reviews[1].id).toContain("yandex-");
  });
});
