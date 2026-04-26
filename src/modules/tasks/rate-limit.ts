import type { NextRequest } from "next/server";
import { redis, redisAvailable } from "@/lib/redis";
import { apiError } from "@/lib/api-response";

/**
 * Custom sliding-window rate limiter for tasks endpoints.
 * Identifies caller by IP (anon endpoints) or userId (authenticated).
 */
export async function rateLimitCustom(
  identifier: string,
  bucketName: string,
  limit: number,
  windowSeconds: number
): Promise<Response | null> {
  if (!redisAvailable) return null;
  const key = `rl:${bucketName}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}:${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, windowSeconds);
    const results = await pipeline.exec();
    const count = results?.[2]?.[1] as number;
    if (count > limit) {
      const retryAfterMin = Math.ceil(windowSeconds / 60);
      const human =
        retryAfterMin >= 60
          ? `Попробуйте через ${Math.ceil(retryAfterMin / 60)} ч.`
          : `Попробуйте через ${retryAfterMin} мин.`;
      return apiError("RATE_LIMIT", `Слишком много заявок. ${human}`, 429);
    }
    return null;
  } catch {
    return null;
  }
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
