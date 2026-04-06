import { redis, redisAvailable } from "./redis";
import { NextRequest } from "next/server";
import { apiError } from "./api-response";

type RateLimitConfig = {
  /** Max requests in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
};

const CONFIGS = {
  public: { limit: 60, windowSeconds: 60 } as RateLimitConfig,
  authenticated: { limit: 120, windowSeconds: 60 } as RateLimitConfig,
} as const;

/**
 * Sliding window rate limiter using Redis.
 * Returns null if within limit, or an error response if exceeded.
 */
export async function rateLimit(
  request: NextRequest,
  type: keyof typeof CONFIGS = "public"
) {
  // Skip rate limiting entirely when Redis is unavailable
  if (!redisAvailable) {
    return null;
  }

  const config = CONFIGS[type];
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const key = `rate-limit:${type}:${ip}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  try {
    const pipeline = redis.pipeline();
    // Remove old entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);
    // Add current request
    pipeline.zadd(key, now, `${now}:${Math.random()}`);
    // Count requests in window
    pipeline.zcard(key);
    // Set expiry on the key
    pipeline.expire(key, config.windowSeconds);

    const results = await pipeline.exec();
    const count = results?.[2]?.[1] as number;

    if (count > config.limit) {
      return apiError(
        "RATE_LIMIT_EXCEEDED",
        `Слишком много запросов. Лимит: ${config.limit} запросов в ${config.windowSeconds} секунд`,
        429
      );
    }

    return null;
  } catch {
    // If Redis is down, allow the request
    return null;
  }
}
