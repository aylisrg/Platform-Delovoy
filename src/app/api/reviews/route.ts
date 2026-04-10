import { apiResponse, apiError } from "@/lib/api-response";
import { redis, redisAvailable } from "@/lib/redis";
import { parseYandexReviews } from "@landing/lib/parsers/yandex-reviews";
import { reviewsQuerySchema } from "@landing/lib/parsers/validation";
import { log } from "@/lib/logger";
import type { ReviewsResponse, ReviewsCache } from "@landing/lib/parsers/types";

const CACHE_KEY = "reviews:yandex";
const CACHE_TTL = 3600; // 1 hour in seconds

const DEFAULT_META = { rating: 5.0, totalReviews: 300 };

/**
 * GET /api/reviews
 *
 * Returns reviews and rating metadata from Yandex Maps with Redis caching.
 *
 * Response shape: { success: true, data: { reviews: Review[], meta: ReviewsMeta } }
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
          return apiResponse<ReviewsResponse>({
            reviews: cacheData.reviews,
            meta: cacheData.meta ?? DEFAULT_META,
          });
        }
      } catch (error) {
        await log.warn("reviews-api", "Failed to read from cache, proceeding to parse", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Parse reviews from Yandex Maps
    const yandexUrl = process.env.YANDEX_MAPS_URL;
    if (!yandexUrl) {
      await log.error("reviews-api", "YANDEX_MAPS_URL is not configured");
      return apiResponse<ReviewsResponse>({ reviews: [], meta: DEFAULT_META });
    }

    const { reviews, meta } = await parseYandexReviews(yandexUrl);

    // Save to Redis cache (if available)
    if (redisAvailable && reviews.length > 0) {
      try {
        const cacheData: ReviewsCache = {
          fetchedAt: Date.now(),
          reviews,
          meta,
        };
        await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(cacheData));
        await log.info("reviews-api", "Saved reviews to cache", {
          count: reviews.length,
          ttl: CACHE_TTL,
        });
      } catch (error) {
        await log.warn("reviews-api", "Failed to save to cache", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return apiResponse<ReviewsResponse>({ reviews, meta });
  } catch (error) {
    await log.error("reviews-api", "Unexpected error in reviews endpoint", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return apiResponse<ReviewsResponse>({ reviews: [], meta: DEFAULT_META });
  }
}
