import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisAvailable: boolean | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 10) {
        console.error("[Redis] Max reconnection attempts reached, stopping retries");
        return null; // Stop reconnecting
      }
      return Math.min(times * 500, 10_000); // 500ms, 1s, 1.5s, ... max 10s
    },
  });

/** Whether Redis is currently connected and usable */
export let redisAvailable = globalForRedis.redisAvailable ?? false;

redis.on("connect", () => {
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
