import crypto from "crypto";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { isDomainError } from "@/modules/users/errors";
import { isDisposableTelegramShell } from "@/modules/users/shell";
import { mergeAccounts } from "@/modules/clients/merge";
import { createMergeRequest } from "@/modules/clients/merge-requests";
import {
  isTransactionalEmailConfigured,
  sendTransactionalEmail,
} from "@/modules/notifications/channels/email";
import { recordBotContact } from "./bot-contact";
import { buildLinkOtpEmail, buildSuperadminLinkInfoEmail } from "./otp-email";
import type {
  LinkRequestResult,
  LinkConfirmResult,
  DeepLinkResult,
  GenerateLinkResult,
  OtpData,
} from "./types";
import { linkEmailSchema, type LinkRequestInput, type DeepLinkInput } from "./validation";

/**
 * Telegram ↔ account linking (ADR 2026-10-25-team-access-notifications §5.3,
 * §Q9; PRD US-E3/US-E4).
 *
 * OTP by email: the code really leaves by email (never logged), the answer
 * never reveals whether the account exists, SUPERADMIN accounts get an info
 * email instead of a code. After a correct code the Mini App's own Telegram
 * account is either a disposable shell (folded into the email account by
 * `mergeAccounts(self_link)`) or has history / the email account already has
 * another Telegram — then a merge request goes to the SUPERADMIN queue and the
 * person sees AC-E4.1.
 */

const OTP_TTL = 600; // 10 minutes
const BLOCK_TTL = 900; // 15 minutes
const MAX_ATTEMPTS = 3;
const HOUR = 3600;
const EMAIL_REQUESTS_PER_HOUR = 3;
const TELEGRAM_REQUESTS_PER_HOUR = 5;
const EMAIL_FAILURES_PER_HOUR = 5;
const DEEP_LINK_TTL = 900; // 15 minutes
const SKIP_TTL = 30 * 24 * 3600; // 30 days
const SMTP_WARNING_INTERVAL_MS = 60_000;

export const LINK_MESSAGES = {
  GENERIC_SENT: "Если такой аккаунт есть, мы отправили код на его email.",
  PHONE_LINK_UNAVAILABLE: "Привязка по телефону пока недоступна",
  OTP_UNAVAILABLE: "Не удалось отправить код. Попробуйте позже или обратитесь к администратору",
  LINK_BLOCKED: "Превышено количество попыток. Попробуйте через 15 минут",
  TOO_MANY_REQUESTS: "Слишком много запросов кода. Попробуйте через час",
  INVALID_CODE: "Неверный код",
  CODE_EXPIRED: "Код истек, запросите новый",
  INVALID_EMAIL: "Некорректный email",
  TELEGRAM_IN_USE_MERGE_REQUESTED:
    "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом",
  INVALID_TOKEN: "Недействительный или истёкший токен",
  ALREADY_LINKED_SELF: "Telegram уже привязан к вашему аккаунту",
} as const;

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
function emailRequestsKey(emailHash: string) {
  return `tg-link:otp-email:${emailHash}`;
}
function telegramRequestsKey(telegramId: string) {
  return `tg-link:otp-tg:${telegramId}`;
}
function emailFailuresKey(emailHash: string) {
  return `tg-link:otp-fail-email:${emailHash}`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function codeHash(code: string, telegramId: string): string {
  return sha256(`${code}${telegramId}`);
}

function hashesEqual(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && expected.length > 0 && crypto.timingSafeEqual(expected, actual);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Fixed-window counter: INCR + EXPIRE on the first hit. */
async function bump(key: string, ttl: number): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttl);
  return count;
}

let lastSmtpWarningAt = 0;
function warnSmtpMissing() {
  const now = Date.now();
  if (now - lastSmtpWarningAt < SMTP_WARNING_INTERVAL_MS) return;
  lastSmtpWarningAt = now;
  void log.warn(EVENT_SOURCES.AUTH, "OTP: SMTP не настроен — коды привязки Telegram не отправляются");
}

/** Test hook. */
export function resetLinkServiceState(): void {
  lastSmtpWarningAt = 0;
}

async function assertNotBlocked(telegramId: string): Promise<void> {
  const blocked = await redis.get(blockKey(telegramId)).catch(() => null);
  if (blocked) throw new LinkError("LINK_BLOCKED", LINK_MESSAGES.LINK_BLOCKED, 429);
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
 * Request an OTP by email (AC-E3.1–E3.7). The answer is the same whether the
 * account exists or not; the code is sent only to a non-SUPERADMIN account
 * that does not own this Telegram yet.
 */
export async function requestLink(
  telegramId: string,
  input: LinkRequestInput
): Promise<LinkRequestResult> {
  if (input.type === "phone") {
    throw new LinkError("PHONE_LINK_UNAVAILABLE", LINK_MESSAGES.PHONE_LINK_UNAVAILABLE, 422);
  }
  const parsedEmail = linkEmailSchema.safeParse(input.value);
  if (!parsedEmail.success) {
    throw new LinkError("VALIDATION_ERROR", LINK_MESSAGES.INVALID_EMAIL, 422);
  }
  const email = parsedEmail.data;

  // For everyone and before any lookup — no oracle (AC-E3.3/AC-E3.5).
  if (!isTransactionalEmailConfigured()) {
    warnSmtpMissing();
    throw new LinkError("OTP_DELIVERY_UNAVAILABLE", LINK_MESSAGES.OTP_UNAVAILABLE, 503);
  }

  await assertNotBlocked(telegramId);

  const emailHash = sha256(email);
  if ((await bump(telegramRequestsKey(telegramId), HOUR)) > TELEGRAM_REQUESTS_PER_HOUR) {
    throw new LinkError("LINK_BLOCKED", LINK_MESSAGES.TOO_MANY_REQUESTS, 429);
  }
  if ((await bump(emailRequestsKey(emailHash), HOUR)) > EMAIL_REQUESTS_PER_HOUR) {
    throw new LinkError("LINK_BLOCKED", LINK_MESSAGES.TOO_MANY_REQUESTS, 429);
  }

  const generic: LinkRequestResult = {
    sent: true,
    maskedValue: maskEmail(email),
    expiresIn: OTP_TTL,
    message: LINK_MESSAGES.GENERIC_SENT,
  };

  const target = await prisma.user.findFirst({
    where: {
      mergedIntoUserId: null,
      OR: [{ emailNormalized: email }, { email: { equals: email, mode: "insensitive" } }],
    },
    select: { id: true, role: true, email: true, telegramId: true },
  });

  // No code: no such account, or it already owns this Telegram.
  if (!target || target.telegramId === telegramId) return generic;

  // Address frozen after repeated wrong codes: silently no code (a distinct
  // answer would reveal that the account exists).
  const failures = Number((await redis.get(emailFailuresKey(emailHash)).catch(() => null)) ?? 0);
  if (failures >= EMAIL_FAILURES_PER_HOUR) return generic;

  const to = target.email ?? email;

  if (target.role === "SUPERADMIN") {
    // ADR §Q9: no OTP to a SUPERADMIN account — the owner of the address gets
    // an info email, the requester the same generic answer.
    const info = buildSuperadminLinkInfoEmail();
    const sent = await sendTransactionalEmail({ to, ...info, sensitive: true });
    if (!sent.success) {
      void log.error(EVENT_SOURCES.AUTH, "OTP info email send failed", { emailHash });
      throw new LinkError("OTP_SEND_FAILED", LINK_MESSAGES.OTP_UNAVAILABLE, 502);
    }
    return generic;
  }

  const code = generateOtp();
  const otp: OtpData = {
    targetUserId: target.id,
    codeHash: codeHash(code, telegramId),
    emailHash,
    attempts: 0,
  };
  await redis.set(otpKey(telegramId), JSON.stringify(otp), "EX", OTP_TTL);

  const sent = await sendTransactionalEmail({ to, ...buildLinkOtpEmail(code), sensitive: true });
  if (!sent.success) {
    await redis.del(otpKey(telegramId)).catch(() => 0);
    void log.error(EVENT_SOURCES.AUTH, "OTP email send failed", { emailHash });
    throw new LinkError("OTP_SEND_FAILED", LINK_MESSAGES.OTP_UNAVAILABLE, 502);
  }

  return generic;
}

function parseOtp(raw: string): OtpData | null {
  try {
    const value = JSON.parse(raw) as Partial<OtpData>;
    if (
      typeof value.targetUserId === "string" &&
      typeof value.codeHash === "string" &&
      typeof value.emailHash === "string" &&
      typeof value.attempts === "number"
    ) {
      return value as OtpData;
    }
  } catch {
    // corrupted / legacy entry → treat as expired
  }
  return null;
}

function telegramInUse(): LinkError {
  return new LinkError("TELEGRAM_IN_USE_MERGE_REQUESTED", LINK_MESSAGES.TELEGRAM_IN_USE_MERGE_REQUESTED, 409);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

type LinkTarget = { id: string; telegramId: string | null };

/**
 * Attach `telegramId` to `target` (ADR §5.3): free Telegram → set it; the
 * Telegram account is a disposable shell → fold it in (`self_link`);
 * otherwise (history, or the target already has another Telegram) → merge
 * request + 409 TELEGRAM_IN_USE_MERGE_REQUESTED (AC-E4.1/AC-E4.2).
 */
async function attachTelegram(target: LinkTarget, telegramId: string): Promise<{ merged: boolean }> {
  const requestMerge = async (otherUserId: string): Promise<never> => {
    await createMergeRequest({ userAId: target.id, userBId: otherUserId, reason: "telegram_conflict", telegramId });
    throw telegramInUse();
  };

  const tgUser = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true },
  });

  if (!tgUser) {
    if (target.telegramId && target.telegramId !== telegramId) {
      throw new LinkError("TELEGRAM_ALREADY_LINKED", LINK_MESSAGES.ALREADY_LINKED_SELF, 409);
    }
    try {
      await prisma.user.update({ where: { id: target.id }, data: { telegramId } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Taken in parallel by another account.
      const other = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
      if (other && other.id !== target.id) return requestMerge(other.id);
    }
    return { merged: false };
  }

  if (tgUser.id === target.id) return { merged: false };
  if (target.telegramId && target.telegramId !== telegramId) return requestMerge(tgUser.id);
  if (!(await isDisposableTelegramShell(tgUser.id))) return requestMerge(tgUser.id);

  try {
    await mergeAccounts({ mode: "self_link", primaryId: target.id, secondaryId: tgUser.id, actorId: target.id });
  } catch (err) {
    // A guard fired between the check and the lock (e.g. the shell just got
    // merged elsewhere) — fall back to the SUPERADMIN queue.
    if (isDomainError(err)) return requestMerge(tgUser.id);
    throw err;
  }
  return { merged: true };
}

/** Delivery channel + bot status after a successful link (AC-E3.8). */
async function afterLinked(userId: string, telegramId: string): Promise<void> {
  try {
    await prisma.userNotificationChannel.upsert({
      where: { userId_kind_address: { userId, kind: "TELEGRAM", address: telegramId } },
      create: {
        userId,
        kind: "TELEGRAM",
        address: telegramId,
        label: "Telegram",
        priority: 10,
        isActive: true,
        verifiedAt: new Date(),
      },
      update: { isActive: true, verifiedAt: new Date() },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  await recordBotContact(telegramId);
}

/**
 * Confirm the OTP and link Telegram to the account the code was sent for.
 */
export async function confirmLink(
  telegramId: string,
  code: string
): Promise<LinkConfirmResult> {
  await assertNotBlocked(telegramId);

  const raw = await redis.get(otpKey(telegramId));
  const otp = raw ? parseOtp(raw) : null;
  if (!otp) {
    throw new LinkError("CODE_EXPIRED", LINK_MESSAGES.CODE_EXPIRED, 410);
  }

  if (!hashesEqual(otp.codeHash, codeHash(code, telegramId))) {
    otp.attempts++;
    await bump(emailFailuresKey(otp.emailHash), HOUR).catch(() => 0);

    if (otp.attempts >= MAX_ATTEMPTS) {
      await redis.set(blockKey(telegramId), "1", "EX", BLOCK_TTL);
      await redis.del(otpKey(telegramId));
      throw new LinkError("LINK_BLOCKED", LINK_MESSAGES.LINK_BLOCKED, 429);
    }

    // Keep the original expiry; XX — never resurrect an expired code.
    await redis.set(otpKey(telegramId), JSON.stringify(otp), "KEEPTTL", "XX");
    throw new LinkError("INVALID_CODE", LINK_MESSAGES.INVALID_CODE, 400);
  }

  // One-time: whoever deletes the entry owns the code.
  const deleted = await redis.del(otpKey(telegramId));
  if (deleted === 0) {
    throw new LinkError("CODE_EXPIRED", LINK_MESSAGES.CODE_EXPIRED, 410);
  }

  const target = await prisma.user.findUnique({
    where: { id: otp.targetUserId },
    select: { id: true, role: true, telegramId: true, mergedIntoUserId: true },
  });
  // No code is ever issued for a SUPERADMIN account (ADR §Q9).
  if (!target || target.mergedIntoUserId || target.role === "SUPERADMIN") {
    throw new LinkError("INVALID_CODE", LINK_MESSAGES.INVALID_CODE, 400);
  }

  const { merged } = await attachTelegram(target, telegramId);
  await afterLinked(target.id, telegramId);

  const linked = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
    select: { id: true, name: true, role: true, telegramId: true, sessionVersion: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: target.id,
      action: "telegram.link.otp",
      entity: "User",
      entityId: target.id,
      metadata: { targetRole: linked.role, merged },
    },
  });

  return {
    linked: true,
    merged,
    user: {
      id: linked.id,
      name: linked.name,
      role: linked.role,
      telegramId: linked.telegramId ?? telegramId,
      sessionVersion: linked.sessionVersion,
    },
    token: "", // the route signs the Mini App token for this user
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
      LINK_MESSAGES.ALREADY_LINKED_SELF,
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
 * Process a deep link from the Telegram bot (web session → bot, any role incl.
 * SUPERADMIN — ownership is proven by the session, ADR §Q9). Same conflict
 * logic as the OTP: shell → self_link merge, otherwise a merge request + 409.
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
      throw new LinkError("INVALID_TOKEN", LINK_MESSAGES.INVALID_TOKEN, 400);
    }

    userId = tokenRecord.userId;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, telegramId: true, mergedIntoUserId: true },
  });
  if (!user || user.mergedIntoUserId) {
    throw new LinkError("INVALID_TOKEN", LINK_MESSAGES.INVALID_TOKEN, 400);
  }

  const { merged } = await attachTelegram(user, input.telegramId);

  // Mark token as used
  await prisma.telegramLinkToken
    .update({ where: { token: input.token }, data: { usedAt: new Date() } })
    .catch(() => null);
  await redis.del(tokenKey(input.token)).catch(() => {});

  await afterLinked(user.id, input.telegramId);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "telegram.link.deeplink",
      entity: "User",
      entityId: user.id,
      metadata: { targetRole: user.role, merged },
    },
  });

  return {
    linked: true,
    userName: user.name,
    merged,
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
