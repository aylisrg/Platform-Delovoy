/**
 * Presence tracking — detects online users for push-or-SSE routing.
 *
 * Mechanism: each SSE connection calls markOnline(userId, connId) and sends
 * a keepalive every 30 s that refreshes the heartbeat key (EX 60).
 * isOnline(userId) checks that heartbeat key — no key → offline.
 *
 * Fallback: if Redis is unavailable, all users are considered offline
 * (push notifications will be sent; duplicates are acceptable in dev).
 */

import { redis, redisAvailable } from "@/lib/redis";

const HB_TTL = 60; // seconds; refreshed every 30 s via SSE keepalive

function hbKey(userId: string): string {
  return `presence:user:${userId}:hb`;
}

function setKey(userId: string): string {
  return `presence:user:${userId}`;
}

/** Call on SSE connect. connId should be a random UUID per connection. */
export async function markOnline(userId: string, connId: string): Promise<void> {
  if (!redisAvailable) return;
  try {
    await Promise.all([
      redis.sadd(setKey(userId), connId),
      redis.set(hbKey(userId), connId, "EX", HB_TTL),
    ]);
  } catch { /* silent — presence is best-effort */ }
}

/** Call on SSE disconnect. */
export async function markOffline(userId: string, connId: string): Promise<void> {
  if (!redisAvailable) return;
  try {
    await redis.srem(setKey(userId), connId);
    // Check if any connections remain; if none, delete heartbeat.
    const remaining = await redis.scard(setKey(userId));
    if (remaining === 0) {
      await redis.del(hbKey(userId));
    }
  } catch { /* silent */ }
}

/** Refresh heartbeat — call from SSE keepalive every 30 s. */
export async function refreshHeartbeat(userId: string): Promise<void> {
  if (!redisAvailable) return;
  try {
    await redis.expire(hbKey(userId), HB_TTL);
  } catch { /* silent */ }
}

/** Returns true if the user has an active SSE connection. */
export async function isOnline(userId: string): Promise<boolean> {
  if (!redisAvailable) return false;
  try {
    const exists = await redis.exists(hbKey(userId));
    return exists === 1;
  } catch {
    return false;
  }
}

/** Mark an admin user's SSE connection for admin-specific presence. */
export async function markAdminOnline(userId: string, connId: string): Promise<void> {
  if (!redisAvailable) return;
  try {
    await Promise.all([
      redis.sadd("presence:admin", userId),
      redis.set(`presence:admin:${userId}:hb`, connId, "EX", HB_TTL),
    ]);
  } catch { /* silent */ }
}

export async function markAdminOffline(userId: string): Promise<void> {
  if (!redisAvailable) return;
  try {
    await Promise.all([
      redis.srem("presence:admin", userId),
      redis.del(`presence:admin:${userId}:hb`),
    ]);
  } catch { /* silent */ }
}

export async function isAnyAdminOnline(): Promise<boolean> {
  if (!redisAvailable) return false;
  try {
    const count = await redis.scard("presence:admin");
    return count > 0;
  } catch {
    return false;
  }
}
