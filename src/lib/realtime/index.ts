/**
 * Realtime event bus — channel-based pub/sub.
 *
 * Uses Redis Pub/Sub when available, falls back to in-memory EventEmitter.
 * Two separate Redis connections are required: one for PUBLISH (shared `redis`
 * singleton) and one dedicated subscriber (ioredis enters subscriber mode
 * and can no longer execute regular commands).
 */

import type { RedisBusEvent } from "./redis-bus";
import { publish as redisPub, subscribe as redisSub } from "./redis-bus";

export type RealtimeEvent = RedisBusEvent;

/** Publish an event on a channel. Fire-and-forget — never throws. */
export async function publish(channel: string, event: RealtimeEvent): Promise<void> {
  await redisPub(channel, event);
}

/**
 * Subscribe to events on a channel.
 * Returns an unsubscribe function — call it when the SSE connection closes.
 */
export function subscribe(
  channel: string,
  listener: (event: RealtimeEvent) => void,
): () => void {
  return redisSub(channel, listener);
}
