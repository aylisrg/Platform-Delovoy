import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisAvailable: boolean | undefined;
};

const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

/**
 * Задержка переподключения: 500ms, 1s, ... до 15s, и НИКОГДА не null.
 * Если клиент прекращает реконнект (return null), после любого сбоя Redis
 * длиннее бюджета попыток процесс навсегда остаётся без rate-limit и
 * realtime — до ручного рестарта app. Восстановление обязано быть
 * автоматическим.
 */
export function redisRetryDelay(times: number): number {
  if (times > 0 && times % 20 === 0) {
    console.error(`[Redis] Всё ещё нет соединения (попытка ${times}), продолжаю реконнект`);
  }
  return Math.min(times * 500, 15_000);
}

/**
 * Общая retry-стратегия для всех ioredis-клиентов процесса.
 * В тестах бесконечный реконнект держал бы event loop открытым и
 * подвешивал vitest — там ограничиваемся парой попыток.
 */
export function redisRetryStrategy(times: number): number | null {
  if (isTestEnv && times > 2) return null;
  return redisRetryDelay(times);
}

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: redisRetryStrategy,
  });

/** Whether Redis is currently connected and usable */
export let redisAvailable = globalForRedis.redisAvailable ?? false;

// "ready", а не "connect": connect — это только TCP; команды принимаются
// после ready. С enableOfflineQueue=false команды между connect и ready
// падали бы зря.
redis.on("ready", () => {
  redisAvailable = true;
  globalForRedis.redisAvailable = true;
});

redis.on("close", () => {
  redisAvailable = false;
  globalForRedis.redisAvailable = false;
});

redis.on("error", (err) => {
  redisAvailable = false;
  globalForRedis.redisAvailable = false;
  // Log only once per error type to avoid spam
  if (process.env.NODE_ENV !== "production") {
    console.warn("[Redis] Connection error:", err.message);
  }
});

// Attempt initial connection (non-blocking)
redis.connect().catch(() => {
  // Connection failed — redisAvailable stays false, requests proceed without Redis
});

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
