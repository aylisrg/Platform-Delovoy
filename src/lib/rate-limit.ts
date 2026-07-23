import { createHash } from "node:crypto";
import { redis, redisAvailable } from "./redis";
import { NextRequest } from "next/server";
import { apiError } from "./api-response";
import { getClientIp } from "./client-ip";
import { log } from "./logger";

type RateLimitConfig = {
  /** Max requests in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
};

// Спец-тиры с фиксированными лимитами.
const STATIC_CONFIGS = {
  // Web Push subscribe/unsubscribe — защита от Service Worker re-registration
  // loop, который мог бы заспамить эндпоинт. См. ADR §API-контракты.
  "web-push-subscribe": { limit: 10, windowSeconds: 60 } as RateLimitConfig,
  // Клиентский error-beacon (public, без auth) — жёстче обычного public:
  // битая страница в цикле ошибок не должна флудить SystemEvent.
  "client-error": { limit: 10, windowSeconds: 60 } as RateLimitConfig,
} as const;

export type RateLimitType = "public" | "authenticated" | keyof typeof STATIC_CONFIGS;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// public/authenticated читаются на каждый вызов: лимит можно поднять/опустить
// через ops-env (RATE_LIMIT_PUBLIC_PER_MIN / RATE_LIMIT_AUTH_PER_MIN) без
// изменения кода. Дефолты подняты с 60/120: российские мобильные операторы
// сидят за CGNAT, один IP делят сотни людей — 60/мин на IP давал 429 целым
// сетям (это и был один из механизмов «с LTE не работает»).
function configFor(type: RateLimitType): RateLimitConfig {
  if (type === "public") {
    return { limit: envInt("RATE_LIMIT_PUBLIC_PER_MIN", 180), windowSeconds: 60 };
  }
  if (type === "authenticated") {
    return { limit: envInt("RATE_LIMIT_AUTH_PER_MIN", 240), windowSeconds: 60 };
  }
  return STATIC_CONFIGS[type];
}

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

// Телеметрия срабатываний: без неё 429-е невидимы (в SystemEvent их не было,
// и CGNAT-эффект на мобильных сетях жил незамеченным). Семплируем
// ≤1 записи в минуту на процесс — сам факт и масштаб видны, флуда нет.
let last429LogAt = 0;

function log429Sampled(type: RateLimitType, subject: string, path: string, limit: number) {
  const now = Date.now();
  if (now - last429LogAt < 60_000) return;
  last429LogAt = now;
  // Сырой IP в SystemEvent не пишем — достаточно стабильного хэша,
  // чтобы отличать «один абонент долбит» от «разные сети упираются».
  const subjectHash = createHash("sha256").update(subject).digest("hex").slice(0, 16);
  void log.warn("rate-limit", `429: превышен лимит ${limit}/мин (${type}) на ${path}`, {
    tier: type,
    path,
    subjectHash,
    limit,
  });
}

/**
 * Sliding window rate limiter using Redis.
 * Returns null if within limit, or an error response if exceeded.
 *
 * @param request - The incoming Next.js request (used for IP-based keying when no userId).
 * @param type - The rate limit tier.
 * @param userId - Optional user id; if provided, rate limit is keyed per-user instead of per-IP.
 */
export async function rateLimit(
  request: NextRequest,
  type: RateLimitType = "public",
  userId?: string
) {
  // Skip rate limiting entirely when Redis is unavailable
  if (!redisAvailable) {
    warnFailOpen("Redis недоступен");
    return null;
  }

  const config = configFor(type);
  // Ключ по доверенному IP (X-Real-IP от nginx / последний hop XFF), а не по
  // всей клиентской XFF-цепочке: её начало спуфится произвольной строкой.
  const subject = userId ? `user:${userId}` : `ip:${getClientIp(request)}`;
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
      log429Sampled(type, subject, request.nextUrl?.pathname ?? "?", config.limit);
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
