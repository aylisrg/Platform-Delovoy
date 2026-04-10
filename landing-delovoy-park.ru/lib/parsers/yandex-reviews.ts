import * as cheerio from "cheerio";
import { log } from "@/lib/logger";
import type { Review, ReviewsMeta } from "./types";

export type ParseResult = {
  reviews: Review[];
  meta: ReviewsMeta;
};

/**
 * Parse reviews and rating metadata from Yandex Maps page
 *
 * @param url - URL to Yandex Maps organization page
 * @returns Parsed reviews and overall rating metadata
 */
export async function parseYandexReviews(url: string): Promise<ParseResult> {
  const defaultMeta: ReviewsMeta = { rating: 5.0, totalReviews: 300 };

  try {
    // Fetch HTML from Yandex Maps
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      await log.warn("reviews-parser", `Failed to fetch Yandex Maps page: ${response.status}`, {
        url,
        status: response.status,
      });
      return { reviews: [], meta: defaultMeta };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // --- Extract overall rating and review count from the page ---
    const meta = parseRatingMeta($) ?? defaultMeta;

    // --- Parse individual reviews ---
    const reviews: Review[] = [];

    // IMPORTANT: These selectors are based on Yandex Maps structure as of 2026
    // They may need to be updated if Yandex changes their HTML structure
    const reviewElements = $('[class*="business-review"]').toArray();

    if (reviewElements.length === 0) {
      await log.warn("reviews-parser", "No review elements found on page", {
        url,
        htmlLength: html.length,
      });
      return { reviews: [], meta };
    }

    // Parse each review element
    for (const element of reviewElements.slice(0, 15)) { // Limit to 15 reviews
      try {
        const $review = $(element);

        // Extract author name
        const author = $review.find('[class*="business-review-author"]').first().text().trim() ||
                      $review.find('[itemprop="author"]').first().text().trim() ||
                      "Аноним";

        // Extract rating (look for stars or rating attribute)
        let rating = 5; // Default to 5
        const ratingElement = $review.find('[class*="business-rating"]').first();
        const ratingText = ratingElement.attr("aria-label") || ratingElement.text();
        const ratingMatch = ratingText?.match(/(\d+)/);
        if (ratingMatch) {
          rating = parseInt(ratingMatch[1], 10);
        }

        // Extract review text
        const text = $review.find('[class*="business-review-body"]').first().text().trim() ||
                    $review.find('[itemprop="reviewBody"]').first().text().trim() ||
                    "";

        // Skip if no text
        if (!text) {
          continue;
        }

        // Extract date
        const date = $review.find('[class*="business-review-date"]').first().text().trim() ||
                    $review.find('time').first().text().trim() ||
                    "недавно";

        // Generate unique ID
        const id = generateReviewId(author, date);

        reviews.push({
          id,
          author,
          rating: Math.min(Math.max(rating, 1), 5), // Ensure 1-5 range
          text: text.substring(0, 1000), // Limit to 1000 chars
          date,
          source: "yandex",
        });
      } catch (error) {
        // Skip this review if parsing fails
        continue;
      }
    }

    await log.info("reviews-parser", `Successfully parsed ${reviews.length} reviews from Yandex Maps`, {
      url,
      count: reviews.length,
      rating: meta.rating,
      totalReviews: meta.totalReviews,
    });

    return { reviews, meta };
  } catch (error) {
    await log.error("reviews-parser", "Failed to parse Yandex Maps reviews", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { reviews: [], meta: defaultMeta };
  }
}

/**
 * Extract overall rating and total review count from the Yandex Maps page
 */
function parseRatingMeta($: cheerio.CheerioAPI): ReviewsMeta | null {
  try {
    // Try multiple selectors for the overall rating
    let rating: number | null = null;
    let totalReviews: number | null = null;

    // Strategy 1: Look for business rating value
    const ratingEl = $('[class*="business-rating-badge"] [class*="rating-value"]').first();
    if (ratingEl.length) {
      const val = parseFloat(ratingEl.text().trim().replace(",", "."));
      if (!isNaN(val) && val >= 1 && val <= 5) rating = val;
    }

    // Strategy 2: Look for rating in structured data
    if (!rating) {
      const ratingValue = $('[itemprop="ratingValue"]').first().attr("content") ||
                         $('[itemprop="ratingValue"]').first().text().trim();
      if (ratingValue) {
        const val = parseFloat(ratingValue.replace(",", "."));
        if (!isNaN(val) && val >= 1 && val <= 5) rating = val;
      }
    }

    // Strategy 3: Look for rating in any business-rating element
    if (!rating) {
      const anyRating = $('[class*="business-rating"]').first();
      const ariaLabel = anyRating.attr("aria-label") || "";
      const match = ariaLabel.match(/([\d,.]+)\s*(из|of)\s*5/);
      if (match) {
        const val = parseFloat(match[1].replace(",", "."));
        if (!isNaN(val) && val >= 1 && val <= 5) rating = val;
      }
    }

    // Extract total review count
    const reviewCountEl = $('[class*="business-rating-badge"] [class*="rating-count"]').first();
    if (reviewCountEl.length) {
      const countText = reviewCountEl.text().replace(/\s/g, "");
      const countMatch = countText.match(/(\d+)/);
      if (countMatch) totalReviews = parseInt(countMatch[1], 10);
    }

    // Strategy 2: structured data
    if (!totalReviews) {
      const reviewCount = $('[itemprop="reviewCount"]').first().attr("content") ||
                         $('[itemprop="reviewCount"]').first().text().trim();
      if (reviewCount) {
        const val = parseInt(reviewCount.replace(/\D/g, ""), 10);
        if (!isNaN(val)) totalReviews = val;
      }
    }

    if (rating || totalReviews) {
      return {
        rating: rating ?? 5.0,
        totalReviews: totalReviews ?? 300,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a unique ID for a review based on author and date
 */
function generateReviewId(author: string, date: string): string {
  // Simple hash function
  const str = `${author}-${date}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `yandex-${Math.abs(hash).toString(36)}`;
}
