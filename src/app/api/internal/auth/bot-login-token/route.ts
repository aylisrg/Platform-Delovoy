/**
 * POST /api/internal/auth/bot-login-token
 *
 * Server-to-server endpoint for the Telegram bot. Mints a one-time
 * bot→web login token for an already-resolved `User.telegramId` and
 * returns a callback URL that the bot embeds in an InlineKeyboard
 * URL-button.
 *
 * Security model (ADR 2026-04-30 §6):
 *   - Mounted under /api/internal/* so nginx can drop external traffic
 *     by source IP (loopback + docker bridge).
 *   - Bearer auth via BOT_INTERNAL_SECRET, compared with
 *     `crypto.timingSafeEqual` to prevent timing oracles.
 *   - Per-telegramId 10/min and global 600/min Redis rate limits.
 *   - SUPERADMIN/ADMIN/MANAGER cannot be logged in via this path
 *     (parity with the web→bot deep-link admin guard).
 *
 * Errors map to ADR §3.1.
 */
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { apiResponse, apiError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { redisAvailable } from "@/lib/redis";
import { logAuthEvent, maskChatId } from "@/lib/audit";
import {
  BOT_LOGIN_TTL_SECONDS,
  checkBotLoginRateLimit,
  createBotLoginToken,
} from "@/modules/auth/telegram-deep-link";

const bodySchema = z.object({
  telegramId: z.string().regex(/^\d{5,15}$/, "telegramId must be 5-15 digits"),
  chatId: z
    .string()
    .regex(/^-?\d{5,15}$/, "chatId must be 5-15 digits (optionally negative)")
    .optional(),
});

/**
 * Constant-time compare two ASCII secrets without throwing on length
 * mismatch. Returns false for any falsy/short input.
 */
function timingSafeEqualString(a: string | null | undefined, b: string): boolean {
  if (!a || typeof a !== "string") return false;
  // crypto.timingSafeEqual requires equal-length buffers. To preserve
  // the timing-safe property we hash both sides first — equal-length
  // SHA-256 digests, regardless of input length.
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function POST(request: NextRequest) {
  const expected = process.env.BOT_INTERNAL_SECRET;
  if (!expected) {
    // No secret configured → fail closed. Endpoint effectively disabled
    // until ops sets BOT_INTERNAL_SECRET in both web and bot containers.
    return apiError(
      "BOT_INTERNAL_NOT_CONFIGURED",
      "Bot integration is not configured",
      503
    );
  }

  // Bearer auth (constant-time compare).
  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!timingSafeEqualString(presented, expected)) {
    return apiError("UNAUTHORIZED", "Invalid bot secret", 401);
  }

  // Body parse + Zod validation.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid payload",
      400
    );
  }
  const { telegramId, chatId } = parsed.data;

  // Redis must be up — token state machine depends on it.
  if (!redisAvailable) {
    return apiError(
      "REDIS_UNAVAILABLE",
      "Token store is temporarily unavailable",
      503
    );
  }

  // Rate limit: per-tg 10/min + global 600/min.
  const rl = await checkBotLoginRateLimit(telegramId);
  if (!rl.allowed) {
    return apiError(
      "RATE_LIMITED",
      rl.scope === "global"
        ? `Global rate limit exceeded. Retry after ${rl.retryAfterSec}s.`
        : `Too many bot-login mints for this user. Retry after ${rl.retryAfterSec}s.`,
      429
    );
  }

  // Resolve the user. Skip merged tombstones.
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, role: true, mergedIntoUserId: true },
  });
  if (!user || user.mergedIntoUserId) {
    return apiError("USER_NOT_FOUND", "No web account linked to this Telegram user", 404);
  }

  // Admin guard — parity with web→bot flow (ADR §6.1, item 4).
  if (user.role !== "USER") {
    await logAuthEvent("auth.signin.failure", user.id, {
      provider: "telegram-token",
      method: "bot-deeplink",
      reason: "ADMIN_NO_BOT_LOGIN",
      role: user.role,
      chatIdMasked: chatId ? maskChatId(chatId) : undefined,
    });
    return apiError(
      "ADMIN_NO_BOT_LOGIN",
      "Administrators cannot sign in via the bot",
      403
    );
  }

  // Mint and persist the token.
  const { token, expiresAt } = await createBotLoginToken({
    userId: user.id,
    telegramId,
  });

  // AuditLog mint event. We log under the existing auth.signin.attempt
  // taxonomy (no schema change for AuditAction enum) with method
  // "bot-deeplink" as the discriminator. ADR §3.1 names this action
  // `auth.bot_login.token_minted`; we map it 1:1 by using attempt+method.
  await logAuthEvent("auth.signin.attempt", user.id, {
    provider: "telegram-token",
    method: "bot-deeplink",
    chatIdMasked: chatId ? maskChatId(chatId) : undefined,
  });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
  const callbackUrl = `${appUrl}/auth/tg-callback?token=${encodeURIComponent(token)}`;

  return apiResponse({
    token,
    expiresAt,
    expiresInSec: BOT_LOGIN_TTL_SECONDS,
    callbackUrl,
  });
}
