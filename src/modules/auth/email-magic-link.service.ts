import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";

const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const COOLDOWN_TTL_SECONDS = 60; // 1 minute between sends

const MAGIC_LINK_PW_PREFIX = "magic-link:pw:";
const MAGIC_LINK_COOLDOWN_PREFIX = "magic-link:cooldown:";

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Check if a magic link can be sent to this email (cooldown).
 * Returns false if within the 60-second cooldown window.
 */
export async function canSendMagicLink(email: string): Promise<boolean> {
  if (!redisAvailable) return true; // Skip cooldown if Redis unavailable
  const key = MAGIC_LINK_COOLDOWN_PREFIX + normalizeEmail(email);
  const existing = await redis.get(key);
  return !existing;
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${appUrl}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

  const result = await sendTransactionalEmail({
    to: email,
    subject: "Деловой Парк — ссылка для входа",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <h2 style="color: #1d1d1f; font-size: 22px; margin-bottom: 8px;">Войти в Деловой Парк</h2>
        <p style="color: #6e6e73; font-size: 15px; margin-bottom: 24px;">
          Нажмите кнопку ниже, чтобы войти в аккаунт. Ссылка действительна 15 минут.
        </p>
        <a href="${url}"
           style="display: inline-block; background: #0071e3; color: #fff; text-decoration: none;
                  padding: 14px 28px; border-radius: 980px; font-size: 15px; font-weight: 500;">
          Войти
        </a>
        <p style="color: #aeaeb2; font-size: 13px; margin-top: 24px;">
          Если вы не запрашивали этот email — просто проигнорируйте его.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #aeaeb2; font-size: 12px; word-break: break-all;">
          Если кнопка не работает, перейдите по ссылке:<br>${url}
        </p>
      </div>
    `,
    text: `Войти в Деловой Парк\n\nПерейдите по ссылке для входа (действительна 15 минут):\n${url}\n\nЕсли вы не запрашивали этот email — проигнорируйте его.`,
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
