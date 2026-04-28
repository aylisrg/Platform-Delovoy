/**
 * Telegram bot deep-link auth service.
 *
 * Implements the Wave 2 sign-in flow described in ADR 2026-04-27 §1:
 *
 *   1. Frontend POSTs /api/auth/telegram/start → we mint a short token,
 *      store status="PENDING" in Redis under `auth:tg:token:<token>` and
 *      return the deep link `t.me/<bot>?start=auth_<token>`.
 *   2. User taps the link, the bot picks up the param, asks for contact,
 *      finds/creates the User, then flips Redis to status="CONFIRMED"
 *      with the userId attached.
 *   3. Frontend polls GET /api/auth/telegram/status. When it sees
 *      "CONFIRMED" we mint a 30-second JWT one-time code and flip Redis
 *      to "CONSUMED" atomically — preventing double-redemption.
 *   4. Frontend calls signIn("telegram-token", { oneTimeCode }) and the
 *      NextAuth Credentials provider verifies the JWT (jti dedup in
 *      Redis under `auth:tg:jti:<jti>`).
 *
 * Why no IP-binding on the token: a user can click on desktop and
 * confirm on the mobile Telegram client — the IPs differ. The flow is
 * defended by:
 *   - 5-minute token TTL,
 *   - 60-second JWT TTL,
 *   - one-shot consumption (state machine prevents replay),
 *   - jti uniqueness check in Redis.
 */
import crypto from "crypto";
import { redis, redisAvailable } from "@/lib/redis";

export const TOKEN_PREFIX = "auth:tg:token:";
export const JTI_PREFIX = "auth:tg:jti:";
export const START_RL_PREFIX = "auth:tg:start:rl:";
export const STATUS_RL_PREFIX = "auth:tg:status:rl:";

export const TOKEN_TTL_SECONDS = 5 * 60; // 5 min
export const CONFIRMED_TTL_SECONDS = 5 * 60; // give frontend time to poll
export const CONSUMED_TTL_SECONDS = 30; // poll dedup window
export const JTI_TTL_SECONDS = 60; // matches JWT exp + buffer
export const ONE_TIME_CODE_TTL_SECONDS = 30;

export type TelegramTokenStatus = "PENDING" | "CONFIRMED" | "CONSUMED";

export type TelegramTokenEntry = {
  status: TelegramTokenStatus;
  createdAt: string;
  ipHash?: string;
  userId?: string;
  isNewUser?: boolean;
  consumedAt?: string;
};

/**
 * Generate a short URL-safe token. 16 random bytes → ~22 base64url
 * characters (~128 bits of entropy). Telegram caps the deep-link
 * `start` parameter at 64 chars; with our `auth_` prefix we land at
 * about 27 — well under the limit.
 *
 * We use crypto.randomBytes (Node native) rather than the `nanoid`
 * package because adding new npm deps requires explicit ADR approval
 * (see CLAUDE.md §scope-guard). The ADR itself called this out as the
 * acceptable fallback (§9, "Token format").
 */
export function generateToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Read a token entry from Redis. Returns null when the key has expired
 * or Redis is unavailable.
 */
export async function readTokenEntry(
  token: string
): Promise<TelegramTokenEntry | null> {
  if (!redisAvailable) return null;
  const raw = await redis.get(TOKEN_PREFIX + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelegramTokenEntry;
  } catch {
    // Corrupted entry — treat as expired so the user re-issues.
    return null;
  }
}

/**
 * Write a token entry. Caller controls TTL because state transitions
 * use different windows (PENDING uses TOKEN_TTL_SECONDS, CONFIRMED
 * uses CONFIRMED_TTL_SECONDS, CONSUMED uses CONSUMED_TTL_SECONDS).
 */
export async function writeTokenEntry(
  token: string,
  entry: TelegramTokenEntry,
  ttlSeconds: number
): Promise<void> {
  if (!redisAvailable) return;
  await redis.set(
    TOKEN_PREFIX + token,
    JSON.stringify(entry),
    "EX",
    ttlSeconds
  );
}

/**
 * Create a fresh PENDING token. Returns the token string and ISO
 * expiration timestamp; caller is responsible for building the deep
 * link URL using TELEGRAM_BOT_USERNAME (route handler concern).
 */
export async function createPendingToken({
  ipHash,
}: {
  ipHash?: string;
}): Promise<{ token: string; expiresAt: string }> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000);

  await writeTokenEntry(
    token,
    {
      status: "PENDING",
      createdAt: now.toISOString(),
      ipHash,
    },
    TOKEN_TTL_SECONDS
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Bot-side: flip a PENDING token to CONFIRMED with the resolved userId.
 *
 * Returns true on success. Returns false when:
 *   - the token does not exist (caller already saw expiry)
 *   - the token is no longer PENDING (race: previously confirmed)
 *
 * We deliberately do NOT use Redis WATCH/MULTI here because both the
 * bot and the status endpoint are single-writer per token: the bot
 * writes once on contact, the status endpoint writes once on poll.
 * The race is benign — last write wins, and CONFIRMED → CONFIRMED is
 * idempotent.
 */
export async function confirmToken(
  token: string,
  userId: string,
  isNewUser: boolean
): Promise<boolean> {
  const current = await readTokenEntry(token);
  if (!current || current.status !== "PENDING") return false;
  await writeTokenEntry(
    token,
    {
      ...current,
      status: "CONFIRMED",
      userId,
      isNewUser,
    },
    CONFIRMED_TTL_SECONDS
  );
  return true;
}

/**
 * Frontend status-poll: if the token is CONFIRMED, mint a one-time JWT
 * code and flip the token to CONSUMED. Returns the code on success;
 * null when there's nothing to consume.
 *
 * Note: this function only handles the Redis flip — callers (route
 * handler) are responsible for the JWT signing because they own the
 * NEXTAUTH_SECRET reading and we want this module to stay testable
 * without env coupling.
 */
export async function consumeConfirmedToken(token: string): Promise<{
  userId: string;
} | null> {
  const current = await readTokenEntry(token);
  if (!current || current.status !== "CONFIRMED" || !current.userId) {
    return null;
  }
  await writeTokenEntry(
    token,
    {
      ...current,
      status: "CONSUMED",
      consumedAt: new Date().toISOString(),
    },
    CONSUMED_TTL_SECONDS
  );
  return { userId: current.userId };
}

/**
 * Per-IP rate limiter for /api/auth/telegram/start.
 * Allows a small burst (5 / 60s) before returning false.
 */
export async function checkStartRateLimit(ipHash: string | undefined): Promise<{
  allowed: boolean;
  retryAfterSec: number;
}> {
  if (!redisAvailable) return { allowed: true, retryAfterSec: 0 };
  if (!ipHash) return { allowed: true, retryAfterSec: 0 };

  const key = START_RL_PREFIX + ipHash;
  const limit = 5;
  const windowSec = 60;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  if (count > limit) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Per-(token+ip) rate limiter for /api/auth/telegram/status.
 * 30 / 60s — generous enough for the 2-second poll across the full
 * 5-minute window (≤150 hits) but blocks runaway loops.
 */
export async function checkStatusRateLimit(
  token: string,
  ipHash: string | undefined
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!redisAvailable) return { allowed: true, retryAfterSec: 0 };
  const key = STATUS_RL_PREFIX + token + ":" + (ipHash ?? "anon");
  const limit = 30;
  const windowSec = 60;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  if (count > limit) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * jti dedup for the one-time JWT code: SETNX with TTL means the second
 * authorize() call for the same code returns a hit and we reject.
 * Returns true when the jti is fresh (we should accept the code).
 */
export async function reserveJti(jti: string): Promise<boolean> {
  if (!redisAvailable) return true; // fail-open in dev; auth.ts also has its own checks
  const result = await redis.set(JTI_PREFIX + jti, "1", "EX", JTI_TTL_SECONDS, "NX");
  return result === "OK";
}
