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
  // Web Push subscribe/unsubscribe — защита от Service Worker re-registration
  // loop, который мог бы заспамить эндпоинт. См. ADR §API-контракты.
  "web-push-subscribe": { limit: 10, windowSeconds: 60 } as RateLimitConfig,
  // Клиентский error-beacon (public, без auth) — жёстче обычного public:
  // битая страница в цикле ошибок не должна флудить SystemEvent.
  "client-error": { limit: 10, windowSeconds: 60 } as RateLimitConfig,
} as const;

// Fail-open — осознанное решение: без Redis запросы пропускаем. Но молчать
// об этом нельзя: отключённый rate-limit оставляет публичные эндпоинты без
// защиты от флуда. Логируем не чаще раза в минуту, чтобы не спамить.
let lastFailOpenLogAt = 0;

function warnFailOpen(reason: string) {
  const now = Date.now();
  if (now - lastFailOpenLogAt < 60_000) return;
  lastFailOpenLogAt = now;
  console.error(`[rate-limit] ОТКЛЮЧЁН (fail-open): ${reason}`);
}

/**
 * Sliding window rate limiter using Redis.
 * Returns null if within limit, or an error response if exceeded.
 *
 * @param request - The incoming Next.js request (used for IP-based keying when no userId).
 * @param type - The rate limit tier from `CONFIGS`.
 * @param userId - Optional user id; if provided, rate limit is keyed per-user instead of per-IP.
 */
export async function rateLimit(
  request: NextRequest,
  type: keyof typeof CONFIGS = "public",
  userId?: string
) {
  // Skip rate limiting entirely when Redis is unavailable
  if (!redisAvailable) {
    warnFailOpen("Redis недоступен");
    return null;
  }

  const config = CONFIGS[type];
  const subject = userId
    ? `user:${userId}`
    : `ip:${request.headers.get("x-forwarded-for") ?? "unknown"}`;
  const key = `rate-limit:${type}:${subject}`;
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
  } catch (err) {
    // If Redis is down, allow the request
    warnFailOpen(`ошибка Redis: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
