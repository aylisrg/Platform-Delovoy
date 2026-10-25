import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";

/**
 * Session revocation for JWT sessions (ADR 2026-10-25-team-access-notifications §Q1).
 *
 * `User.sessionVersion` is bumped in the same transaction as any operation that
 * must cut existing access (exclusion from the team, demotion, revoked section,
 * merge as the secondary account). Tokens carry the version they were issued
 * with (claim `sv`); the full NextAuth `jwt` callback and the Mini App token
 * verifier compare it against this state and re-read role/sections — or drop
 * the session — on mismatch.
 *
 * The state is cached in Redis for at most 60 s, which bounds how stale a
 * revocation can be when `publishAuthState` fails (AC-A1.5 budget).
 */

export type AuthState = { sessionVersion: number; role: Role; merged: boolean };

export const AUTH_STATE_TTL_SECONDS = 60;

const key = (userId: string) => `auth:state:${userId}`;

function parseState(raw: string): AuthState | null {
  try {
    const value = JSON.parse(raw) as Partial<AuthState>;
    if (
      typeof value.sessionVersion === "number" &&
      typeof value.role === "string" &&
      typeof value.merged === "boolean"
    ) {
      return { sessionVersion: value.sessionVersion, role: value.role as Role, merged: value.merged };
    }
  } catch {
    // corrupted cache entry → fall through to the DB
  }
  return null;
}

async function readFromDb(userId: string): Promise<AuthState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true, role: true, mergedIntoUserId: true },
  });
  if (!user) return null;
  return { sessionVersion: user.sessionVersion, role: user.role, merged: user.mergedIntoUserId !== null };
}

async function writeCache(userId: string, state: AuthState): Promise<void> {
  if (!redisAvailable) return;
  try {
    await redis.set(key(userId), JSON.stringify(state), "EX", AUTH_STATE_TTL_SECONDS);
  } catch {
    // TTL of any previous entry still bounds staleness
  }
}

/**
 * Current auth state of a user: Redis (≤ 60 s old) → DB.
 * `null` — the user no longer exists; `"unavailable"` — neither Redis nor the
 * DB answered (callers fail open: without a DB the app is down anyway).
 */
export async function getAuthState(userId: string): Promise<AuthState | null | "unavailable"> {
  if (redisAvailable) {
    try {
      const raw = await redis.get(key(userId));
      const cached = raw ? parseState(raw) : null;
      if (cached) return cached;
    } catch {
      // Redis hiccup → DB
    }
  }

  try {
    const state = await readFromDb(userId);
    if (state) await writeCache(userId, state);
    return state;
  } catch {
    return "unavailable";
  }
}

/** Increment the session version inside the caller's transaction. */
export async function bumpSessionVersion(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const updated = await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return updated.sessionVersion;
}

/**
 * Publish the committed state so revocation applies from the next request
 * instead of after the cache TTL. Call after the transaction commits; never throws.
 */
export async function publishAuthState(userId: string): Promise<void> {
  try {
    const state = await readFromDb(userId);
    if (state) {
      await writeCache(userId, state);
    } else if (redisAvailable) {
      await redis.del(key(userId));
    }
  } catch {
    // best effort — the 60 s TTL is the fallback
  }
}
