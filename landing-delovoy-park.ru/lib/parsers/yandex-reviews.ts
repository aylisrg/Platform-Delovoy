import * as cheerio from "cheerio";
import { log } from "@/lib/logger";
import type { Review } from "./types";

/**
 * Parse reviews from Yandex Maps page
 *
 * @param url - URL to Yandex Maps organization page
 * @returns Array of parsed reviews
 */
export async function parseYandexReviews(url: string): Promise<Review[]> {
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
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const reviews: Review[] = [];

    // IMPORTANT: These selectors are based on Yandex Maps structure as of 2026
    // They may need to be updated if Yandex changes their HTML structure

    // Try multiple selector strategies for robustness
    const reviewElements = $('[class*="business-review"]').toArray();

    if (reviewElements.length === 0) {
      await log.warn("reviews-parser", "No review elements found on page", {
        url,
        htmlLength: html.length,
      });
      return [];
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
    });

    return reviews;
  } catch (error) {
    await log.error("reviews-parser", "Failed to parse Yandex Maps reviews", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
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
