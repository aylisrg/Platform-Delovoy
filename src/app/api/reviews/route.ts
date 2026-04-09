import { apiResponse, apiError } from "@/lib/api-response";
import { redis, redisAvailable } from "@/lib/redis";
import { parseYandexReviews } from "@landing/lib/parsers/yandex-reviews";
import { reviewsQuerySchema } from "@landing/lib/parsers/validation";
import { log } from "@/lib/logger";
import type { Review, ReviewsCache } from "@landing/lib/parsers/types";

const CACHE_KEY = "reviews:yandex";
const CACHE_TTL = 3600; // 1 hour in seconds

/**
 * GET /api/reviews
 *
 * Returns reviews from Yandex Maps with Redis caching
 *
 * Strategy:
 * 1. Check Redis cache
 * 2. If cached and fresh → return from cache
 * 3. If not cached → parse from Yandex Maps
 * 4. Save to Redis with TTL
 * 5. Return reviews
 *
 * Fallback: If parsing fails, return empty array (UI shows fallback)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = reviewsQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries())
    );
    const forceRefresh = params.success && params.data.refresh === "1";

    // Check Redis cache first (unless force refresh)
    if (!forceRefresh && redisAvailable) {
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          const cacheData: ReviewsCache = JSON.parse(cached);
          await log.info("reviews-api", "Returning cached reviews", {
            count: cacheData.reviews.length,
            fetchedAt: new Date(cacheData.fetchedAt).toISOString(),
          });
          return apiResponse<Review[]>(cacheData.reviews);
        }
      } catch (error) {
        // Cache read failed, proceed to parse
        await log.warn("reviews-api", "Failed to read from cache, proceeding to parse", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Parse reviews from Yandex Maps
    const yandexUrl = process.env.YANDEX_MAPS_URL;
    if (!yandexUrl) {
      await log.error("reviews-api", "YANDEX_MAPS_URL is not configured");
      return apiResponse<Review[]>([]); // Return empty array for graceful degradation
    }

    const reviews = await parseYandexReviews(yandexUrl);

    // Save to Redis cache (if available)
    if (redisAvailable && reviews.length > 0) {
      try {
        const cacheData: ReviewsCache = {
          fetchedAt: Date.now(),
          reviews,
        };
        await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(cacheData));
        await log.info("reviews-api", "Saved reviews to cache", {
          count: reviews.length,
          ttl: CACHE_TTL,
        });
      } catch (error) {
        // Cache write failed, but we still have reviews to return
        await log.warn("reviews-api", "Failed to save to cache", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return apiResponse<Review[]>(reviews);
  } catch (error) {
    await log.error("reviews-api", "Unexpected error in reviews endpoint", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Graceful degradation: return empty array instead of error
    // UI will show fallback message
    return apiResponse<Review[]>([]);
  }
}
