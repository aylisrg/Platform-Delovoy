import crypto from "crypto";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import type {
  LinkRequestResult,
  LinkConfirmResult,
  DeepLinkResult,
  GenerateLinkResult,
  OtpData,
} from "./types";
import type { LinkRequestInput, DeepLinkInput } from "./validation";

const OTP_TTL = 600; // 10 minutes
const BLOCK_TTL = 900; // 15 minutes
const MAX_ATTEMPTS = 3;
const DEEP_LINK_TTL = 900; // 15 minutes
const SKIP_TTL = 30 * 24 * 3600; // 30 days

function otpKey(telegramId: string) {
  return `tg-link:otp:${telegramId}`;
}
function blockKey(telegramId: string) {
  return `tg-link:block:${telegramId}`;
}
function skipKey(telegramId: string) {
  return `tg-link:skipped:${telegramId}`;
}
function tokenKey(token: string) {
  return `tg-link:token:${token}`;
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return "***";
  return phone.slice(0, 4) + "***" + phone.slice(-2);
}

/**
 * Check if the given telegramId has skipped linking.
 */
export async function hasSkippedLinking(telegramId: string): Promise<boolean> {
  try {
    const val = await redis.get(skipKey(telegramId));
    return val === "1";
  } catch {
    return false;
  }
}

/**
 * Request OTP for linking Telegram to an existing account.
 * Finds user by email or phone, generates OTP, sends it.
 */
export async function requestLink(
  telegramId: string,
  input: LinkRequestInput
): Promise<LinkRequestResult> {
  // Check if telegramId is already linked
  const existingByTg = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true },
  });
  if (existingByTg) {
    throw new LinkError("TELEGRAM_ALREADY_LINKED", "Этот Telegram уже привязан к аккаунту", 409);
  }

  // Check block
  const blocked = await redis.get(blockKey(telegramId)).catch(() => null);
  if (blocked) {
    throw new LinkError(
      "LINK_BLOCKED",
      "Превышено количество попыток. Попробуйте через 15 минут",
      429
    );
  }

  // Find user by email or phone
  const where =
    input.type === "email"
      ? { email: input.value.toLowerCase().trim() }
      : { phone: input.value.trim() };

  const targetUser = await prisma.user.findUnique({
    where,
    select: { id: true, telegramId: true, email: true, phone: true },
  });

  if (!targetUser) {
    throw new LinkError(
      "ACCOUNT_NOT_FOUND",
      "Аккаунт с таким email/телефоном не найден",
      404
    );
  }

  // Check if target user already has a different Telegram linked
  if (targetUser.telegramId && targetUser.telegramId !== telegramId) {
    throw new LinkError(
      "TELEGRAM_ALREADY_LINKED",
      "К этому аккаунту уже привязан другой Telegram",
      409
    );
  }

  // Generate and store OTP
  const code = generateOtp();
  const otpData: OtpData = {
    userId: targetUser.id,
    type: input.type,
    value: input.value,
    code,
    attempts: 0,
  };

  await redis.set(otpKey(telegramId), JSON.stringify(otpData), "EX", OTP_TTL);

  // Send OTP (best-effort — don't block on failure)
  // In production, this would call email/SMS service
  console.log(`[TelegramLink] OTP ${code} sent to ${input.type}: ${input.value}`);

  const maskedValue =
    input.type === "email"
      ? maskEmail(input.value)
      : maskPhone(input.value);

  return {
    sent: true,
    maskedValue,
    expiresIn: OTP_TTL,
  };
}

/**
 * Confirm OTP and link Telegram to the existing account.
 */
export async function confirmLink(
  telegramId: string,
  code: string
): Promise<LinkConfirmResult> {
  // Check block
  const blocked = await redis.get(blockKey(telegramId)).catch(() => null);
  if (blocked) {
    throw new LinkError(
      "LINK_BLOCKED",
      "Превышено количество попыток. Попробуйте через 15 минут",
      429
    );
  }

  const raw = await redis.get(otpKey(telegramId));
  if (!raw) {
    throw new LinkError("CODE_EXPIRED", "Код истек, запросите новый", 410);
  }

  const otpData: OtpData = JSON.parse(raw);

  if (otpData.code !== code) {
    otpData.attempts++;

    if (otpData.attempts >= MAX_ATTEMPTS) {
      // Block further attempts
      await redis.set(blockKey(telegramId), "1", "EX", BLOCK_TTL);
      await redis.del(otpKey(telegramId));
      throw new LinkError(
        "LINK_BLOCKED",
        "Превышено количество попыток. Попробуйте через 15 минут",
        429
      );
    }

    // Save incremented attempts
    await redis.set(
      otpKey(telegramId),
      JSON.stringify(otpData),
      "EX",
      OTP_TTL
    );

    throw new LinkError("INVALID_CODE", "Неверный код", 400);
  }

  // OTP matches — link the accounts
  const updatedUser = await prisma.user.update({
    where: { id: otpData.userId },
    data: { telegramId },
    select: { id: true, name: true, role: true, telegramId: true },
  });

  // Clean up OTP
  await redis.del(otpKey(telegramId));

  return {
    linked: true,
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      role: updatedUser.role,
      telegramId: updatedUser.telegramId!,
    },
    token: "", // JWT will be set by the route handler
  };
}

/**
 * Skip account linking — remember the choice for 30 days.
 */
export async function skipLink(telegramId: string): Promise<void> {
  await redis.set(skipKey(telegramId), "1", "EX", SKIP_TTL);
}

/**
 * Generate a deep link token for linking Telegram from the website.
 */
export async function generateDeepLink(
  userId: string
): Promise<GenerateLinkResult> {
  // Check if user already has Telegram linked
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  });

  if (user?.telegramId) {
    throw new LinkError(
      "TELEGRAM_ALREADY_LINKED",
      "Telegram уже привязан к вашему аккаунту",
      409
    );
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + DEEP_LINK_TTL * 1000);

  // Store in DB for persistence
  await prisma.telegramLinkToken.create({
    data: { userId, token, expiresAt },
  });

  // Also cache in Redis for fast lookup
  await redis.set(tokenKey(token), userId, "EX", DEEP_LINK_TTL);

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "DelovoyPark_bot";
  const deepLink = `https://t.me/${botUsername}?start=link_${token}`;

  return {
    deepLink,
    expiresIn: DEEP_LINK_TTL,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Process a deep link from the Telegram bot.
 */
export async function processDeepLink(
  input: DeepLinkInput
): Promise<DeepLinkResult> {
  // First try Redis for speed
  let userId = await redis.get(tokenKey(input.token)).catch(() => null);

  if (!userId) {
    // Fallback to DB
    const tokenRecord = await prisma.telegramLinkToken.findUnique({
      where: { token: input.token },
      select: { userId: true, expiresAt: true, usedAt: true },
    });

    if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt < new Date()) {
      throw new LinkError(
        "INVALID_TOKEN",
        "Недействительный или истёкший токен",
        400
      );
    }

    userId = tokenRecord.userId;
  }

  // Check if this telegramId is already linked to another user
  const existingByTg = await prisma.user.findUnique({
    where: { telegramId: input.telegramId },
    select: { id: true },
  });

  if (existingByTg && existingByTg.id !== userId) {
    throw new LinkError(
      "TELEGRAM_ALREADY_LINKED",
      "Этот Telegram уже привязан к другому аккаунту",
      409
    );
  }

  // Link the Telegram ID
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { telegramId: input.telegramId },
    select: { id: true, name: true },
  });

  // Mark token as used
  await prisma.telegramLinkToken.update({
    where: { token: input.token },
    data: { usedAt: new Date() },
  });

  // Clean up Redis
  await redis.del(tokenKey(input.token)).catch(() => {});

  return {
    linked: true,
    userName: updatedUser.name,
  };
}

/**
 * Custom error class for link operations.
 */
export class LinkError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "LinkError";
  }
}
