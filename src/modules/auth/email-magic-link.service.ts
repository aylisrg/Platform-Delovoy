import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";
import { magicLinkHtml, magicLinkText } from "@/modules/notifications/email-templates";

const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const COOLDOWN_TTL_SECONDS = 60; // 1 minute between sends
const SIGNIN_NONCE_TTL_SECONDS = 5 * 60; // 5 minutes between verify-email and signIn

const MAGIC_LINK_PW_PREFIX = "magic-link:pw:";
const MAGIC_LINK_COOLDOWN_PREFIX = "magic-link:cooldown:";
const MAGIC_LINK_SIGNIN_PREFIX = "magic-link:signin:";

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Check if a magic link can be sent to this email (cooldown).
 * Returns false if within the 60-second cooldown window.
 *
 * Uses Redis as primary store. Falls back to the VerificationToken table
 * when Redis is unavailable so flooding is still blocked during outages:
 * a token issued <60s ago still has expires > now + (TTL - COOLDOWN).
 */
export async function canSendMagicLink(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);

  if (redisAvailable) {
    const key = MAGIC_LINK_COOLDOWN_PREFIX + normalized;
    const existing = await redis.get(key);
    return !existing;
  }

  const cooldownCutoff = new Date(
    Date.now() + (TOKEN_TTL_SECONDS - COOLDOWN_TTL_SECONDS) * 1000
  );
  const recentToken = await prisma.verificationToken.findFirst({
    where: { identifier: normalized, expires: { gt: cooldownCutoff } },
    select: { token: true },
  });
  return !recentToken;
}

/**
 * Generate a magic link token, store it in VerificationToken, and optionally
 * store the password hash in Redis for post-verification account creation.
 *
 * Returns the raw token string.
 */
export async function generateAndStoreMagicLink(
  email: string,
  password?: string
): Promise<string> {
  const normalized = normalizeEmail(email);
  const token = generateToken();
  const expires = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

  // Delete any existing token for this identifier (prevent accumulation)
  await prisma.verificationToken.deleteMany({
    where: { identifier: normalized },
  });

  // Store the new token
  await prisma.verificationToken.create({
    data: {
      identifier: normalized,
      token,
      expires,
    },
  });

  // If a password was provided, hash and store in Redis for account creation
  if (password && redisAvailable) {
    const hash = await bcrypt.hash(password, 10);
    await redis.set(
      MAGIC_LINK_PW_PREFIX + token,
      hash,
      "EX",
      TOKEN_TTL_SECONDS
    );
  }

  // Set cooldown
  if (redisAvailable) {
    await redis.set(
      MAGIC_LINK_COOLDOWN_PREFIX + normalized,
      "1",
      "EX",
      COOLDOWN_TTL_SECONDS
    );
  }

  return token;
}

/**
 * Send the magic link email to the user.
 */
export async function sendMagicLinkEmail(
  email: string,
  token: string
): Promise<void> {
  const appUrl = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${appUrl}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

  const templateData = { url, expires: "15 минут" };
  const result = await sendTransactionalEmail({
    to: email,
    subject: "Деловой Парк — ссылка для входа",
    html: magicLinkHtml(templateData),
    text: magicLinkText(templateData),
  });

  if (!result.success) {
    throw new Error("EMAIL_SEND_FAILED");
  }
}

export type VerifyResult = {
  userId: string;
  isNewUser: boolean;
};

/**
 * Validate a magic link token and sign in / create the user.
 *
 * Throws:
 *   - Error("TOKEN_INVALID") if token not found
 *   - Error("TOKEN_EXPIRED") if token has expired
 *   - Error("EMAIL_SEND_FAILED") propagated from sendMagicLinkEmail
 */
export async function verifyMagicLink(
  token: string,
  email: string
): Promise<VerifyResult> {
  const normalized = normalizeEmail(email);

  const record = await prisma.verificationToken.findFirst({
    where: { token, identifier: normalized },
  });

  if (!record) {
    throw new Error("TOKEN_INVALID");
  }

  if (record.expires < new Date()) {
    // Clean up expired token
    await prisma.verificationToken.deleteMany({
      where: { identifier: normalized, token },
    });
    throw new Error("TOKEN_EXPIRED");
  }

  // One-time use: delete the token immediately
  await prisma.verificationToken.deleteMany({
    where: { identifier: normalized, token },
  });

  // Look up optional password hash from Redis
  let passwordHash: string | null = null;
  if (redisAvailable) {
    passwordHash = await redis.get(MAGIC_LINK_PW_PREFIX + token);
    await redis.del(MAGIC_LINK_PW_PREFIX + token);
  }

  // Find or create user
  let user = await prisma.user.findUnique({
    where: { email: normalized },
  });

  if (user) {
    // Existing user — mark email as verified if not already
    if (!user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }
    return { userId: user.id, isNewUser: false };
  }

  // New user — create account
  user = await prisma.user.create({
    data: {
      email: normalized,
      role: "USER",
      emailVerified: new Date(),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });

  return { userId: user.id, isNewUser: true };
}

/**
 * Generate a one-time sign-in nonce and store userId under it in Redis.
 *
 * Used to bridge the verify-email step (server-side token check) and the
 * client-side signIn("magic-link", { nonce }) call without exposing userId
 * in the URL. Without this nonce, knowing a user's cuid would be enough
 * to pass the legacy `signIn("magic-link", { userId })` provider — that's
 * the security hole this closes.
 *
 * Throws Error("REDIS_UNAVAILABLE") when Redis is down — fail-closed:
 * we'd rather break the email-link login than create a session without
 * proof of email ownership.
 */
export async function generateSignInNonce(userId: string): Promise<string> {
  if (!redisAvailable) throw new Error("REDIS_UNAVAILABLE");
  const nonce = crypto.randomBytes(32).toString("hex");
  await redis.set(
    MAGIC_LINK_SIGNIN_PREFIX + nonce,
    userId,
    "EX",
    SIGNIN_NONCE_TTL_SECONDS
  );
  return nonce;
}

/**
 * Atomically read-and-delete a sign-in nonce. Returns the userId on
 * success, null when the nonce is unknown / already consumed / Redis is
 * down (fail-closed).
 *
 * Uses Redis GETDEL so two simultaneous sign-in attempts with the same
 * nonce can't both succeed.
 */
export async function consumeSignInNonce(nonce: string): Promise<string | null> {
  if (!redisAvailable) return null;
  if (!nonce || typeof nonce !== "string") return null;
  const userId = await redis.getdel(MAGIC_LINK_SIGNIN_PREFIX + nonce);
  return userId ?? null;
}
