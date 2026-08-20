/**
 * Redis Pub/Sub bus implementation.
 *
 * Two ioredis clients:
 *   1. `redis` (shared singleton from @/lib/redis) — for PUBLISH only.
 *   2. `subscriber` (lazy private singleton) — SUBSCRIBE only.
 *      На RESP2 подписанное соединение не принимало других команд; с ioredis 6
 *      (RESP3 по умолчанию) это ограничение снято и `client.mode` остаётся
 *      "normal". Отдельного клиента всё равно держим: publish на том же
 *      соединении смешивал бы поток push-сообщений с ответами команд, а после
 *      реконнекта ioredis восстанавливает подписки именно этого клиента.
 *
 * Local fan-out: multiple in-process listeners on the same channel are
 * managed via a Map<channel, Set<listener>>. A Redis SUBSCRIBE is issued
 * only on the first listener for a channel and unsubscribed on the last.
 *
 * Falls back to in-memory EventEmitter when Redis is unavailable (dev/test).
 */

import { EventEmitter } from "events";
import { redis, redisAvailable, redisRetryStrategy } from "@/lib/redis";

export type RedisBusEvent = {
  type: string;
  [key: string]: unknown;
};

// In-memory fallback for dev without Redis.
const fallbackEmitter = new EventEmitter();
fallbackEmitter.setMaxListeners(1000);

// Local listener registry: channel → Set of listeners.
const listeners = new Map<string, Set<(event: RedisBusEvent) => void>>();

// Lazy subscriber singleton.
let _subscriber: import("ioredis").Redis | null = null;

function getSubscriber(): import("ioredis").Redis {
  if (!_subscriber) {
    // Dynamically require ioredis to match the exact version used by redis.ts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    _subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      // Никогда не сдаёмся (см. redisRetryStrategy): подписчик, переставший
      // реконнектиться, молча убивает realtime до рестарта процесса.
      // После реконнекта ioredis сам восстанавливает активные SUBSCRIBE.
      retryStrategy: redisRetryStrategy,
    });

    _subscriber!.on("message", (channel: string, raw: string) => {
      try {
        const event: RedisBusEvent = JSON.parse(raw);
        const channelListeners = listeners.get(channel);
        if (!channelListeners) return;
        for (const fn of channelListeners) {
          try { fn(event); } catch { /* individual listener errors are isolated */ }
        }
      } catch {
        // Malformed payload — drop silently.
      }
    });

    _subscriber!.on("error", (err: Error) => {
      console.warn("[realtime:subscriber] Redis error:", err.message);
    });
  }
  return _subscriber!;
}

// ── publish ──────────────────────────────────────────────────────────────

export async function publish(channel: string, event: RedisBusEvent): Promise<void> {
  if (!redisAvailable) {
    // Fallback: fan-out directly in-process.
    fallbackEmitter.emit(channel, event);
    return;
  }
  try {
    await redis.publish(channel, JSON.stringify(event));
  } catch (err) {
    console.warn("[realtime:publish] failed:", err);
    // Fall through without throwing.
  }
}

// ── subscribe ────────────────────────────────────────────────────────────

export function subscribe(
  channel: string,
  listener: (event: RedisBusEvent) => void,
): () => void {
  if (!redisAvailable) {
    fallbackEmitter.on(channel, listener);
    return () => fallbackEmitter.off(channel, listener);
  }

  // Register locally.
  if (!listeners.has(channel)) {
    listeners.set(channel, new Set());
    // Tell Redis to start delivering messages on this channel.
    getSubscriber().subscribe(channel).catch((err) => {
      console.warn("[realtime:subscribe] failed:", err);
    });
  }
  listeners.get(channel)!.add(listener);

  return () => {
    const set = listeners.get(channel);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(channel);
      getSubscriber().unsubscribe(channel).catch(() => {});
    }
  };
}
