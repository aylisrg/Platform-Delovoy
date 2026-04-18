import crypto from "crypto";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { sendWhatsAppMessage, isGreenApiConfigured } from "@/lib/green-api";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";
import type {
  ProfileData,
  UpdateNameInput,
  AttachEmailRequestInput,
  AttachEmailConfirmInput,
  AttachPhoneRequestInput,
  AttachPhoneConfirmInput,
  AttachEmailRequestResult,
  AttachEmailConfirmResult,
  AttachPhoneRequestResult,
  AttachPhoneConfirmResult,
  DetachableChannel,
} from "./types";

// Redis key prefixes — separate from auth flows
const PROFILE_EMAIL_VERIFY_PREFIX = "profile:email-verify:";
const PROFILE_PHONE_OTP_PREFIX = "profile:phone-otp:";
const PROFILE_PHONE_COOLDOWN_PREFIX = "profile:phone-cooldown:";

const EMAIL_TOKEN_TTL = 600; // 10 minutes
const PHONE_OTP_TTL = 300;   // 5 minutes
const PHONE_COOLDOWN_TTL = 60; // 1 minute between sends
const MAX_PHONE_ATTEMPTS = 5;

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("8") && digits.length === 11
    ? "7" + digits.slice(1)
    : digits;
}

function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ── GET PROFILE ──────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<ProfileData> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      image: true,
      email: true,
      phone: true,
      telegramId: true,
      accounts: {
        where: { provider: "yandex" },
        select: { providerAccountId: true },
        take: 1,
      },
    },
  });

  return {
    id: user.id,
    name: user.name,
    image: user.image,
    contacts: {
      telegram: user.telegramId,
      yandex: user.accounts.length > 0
        ? { email: user.email ?? user.accounts[0].providerAccountId, name: user.name }
        : null,
      email: user.email,
      phone: user.phone,
    },
  };
}

// ── DETACH CHANNEL ──────────────────────────────────────────────────────────

export async function detachChannel(
  userId: string,
  channel: DetachableChannel
): Promise<{ detached: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      telegramId: true,
      email: true,
      phone: true,
      passwordHash: true,
      accounts: {
        select: { provider: true },
      },
    },
  });

  // Count active auth methods
  let authMethodCount = 0;
  if (user.telegramId) authMethodCount++;
  if (user.email) authMethodCount++;
  if (user.phone) authMethodCount++;
  if (user.passwordHash) authMethodCount++;
  for (const acc of user.accounts) {
    if (acc.provider === "yandex" || acc.provider === "google") {
      authMethodCount++;
    }
  }

  if (authMethodCount <= 1) {
    throw Object.assign(
      new Error("Это единственный способ входа. Привяжите другой канал перед отвязкой."),
      { code: "LAST_AUTH_METHOD" }
    );
  }

  // Verify channel is attached
  switch (channel) {
    case "telegram":
      if (!user.telegramId) {
        throw Object.assign(new Error("Этот канал не привязан к вашему аккаунту"), { code: "NOT_ATTACHED" });
      }
      await prisma.user.update({ where: { id: userId }, data: { telegramId: null } });
      break;

    case "email":
      if (!user.email) {
        throw Object.assign(new Error("Этот канал не привязан к вашему аккаунту"), { code: "NOT_ATTACHED" });
      }
      await prisma.user.update({ where: { id: userId }, data: { email: null, emailVerified: null } });
      break;

    case "phone":
      if (!user.phone) {
        throw Object.assign(new Error("Этот канал не привязан к вашему аккаунту"), { code: "NOT_ATTACHED" });
      }
      await prisma.user.update({ where: { id: userId }, data: { phone: null } });
      break;

    case "yandex": {
      const yandexAccount = user.accounts.find((a) => a.provider === "yandex");
      if (!yandexAccount) {
        throw Object.assign(new Error("Этот канал не привязан к вашему аккаунту"), { code: "NOT_ATTACHED" });
      }
      await prisma.account.deleteMany({ where: { userId, provider: "yandex" } });
      break;
    }
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: "profile.detach",
      entity: "User",
      entityId: userId,
      metadata: { channel },
    },
  });

  return { detached: channel };
}

// ── UPDATE NAME ───────────────────────────────────────────────────────────────

export async function updateName(
  userId: string,
  input: UpdateNameInput
): Promise<{ name: string }> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name },
    select: { name: true },
  });

  return { name: updated.name! };
}

// ── ATTACH EMAIL ─────────────────────────────────────────────────────────────

export async function requestEmailAttach(
  userId: string,
  input: AttachEmailRequestInput
): Promise<AttachEmailRequestResult> {
  const normalized = input.email.toLowerCase().trim();

  // Check if already attached to this account
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (currentUser?.email === normalized) {
    throw Object.assign(new Error("Email уже привязан к вашему аккаунту"), {
      code: "EMAIL_ALREADY_ATTACHED",
    });
  }

  // Check if used by another account
  const existingOwner = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });

  if (existingOwner && existingOwner.id !== userId) {
    throw Object.assign(new Error("Email уже привязан к другому аккаунту"), {
      code: "EMAIL_IN_USE",
    });
  }

  // Generate and store verification token
  const token = generateToken();
  const key = PROFILE_EMAIL_VERIFY_PREFIX + userId;

  // Store: token → email (so we know which email to attach on confirm)
  await redis.set(key, `${token}:${normalized}`, "EX", EMAIL_TOKEN_TTL);

  // Send verification email
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const verifyUrl = `${appUrl}/dashboard?attachEmail=${token}`;

  const result = await sendTransactionalEmail({
    to: normalized,
    subject: "Деловой Парк — подтвердите email",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #fff;">
        <h2 style="color: #1d1d1f; font-size: 22px; margin-bottom: 8px;">Подтвердите email</h2>
        <p style="color: #6e6e73; font-size: 15px; margin-bottom: 24px;">
          Нажмите кнопку ниже, чтобы привязать этот адрес к вашему аккаунту в Деловой Парк. Ссылка действительна 10 минут.
        </p>
        <a href="${verifyUrl}"
           style="display: inline-block; background: #0071e3; color: #fff; text-decoration: none;
                  padding: 14px 28px; border-radius: 980px; font-size: 15px; font-weight: 500;">
          Подтвердить email
        </a>
        <p style="color: #aeaeb2; font-size: 13px; margin-top: 24px;">
          Если вы не запрашивали это письмо — просто проигнорируйте его.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #aeaeb2; font-size: 12px; word-break: break-all;">
          Если кнопка не работает, перейдите по ссылке:<br>${verifyUrl}
        </p>
      </div>
    `,
    text: `Деловой Парк — подтвердите email\n\nПерейдите по ссылке для привязки email (действительна 10 минут):\n${verifyUrl}\n\nЕсли вы не запрашивали это — проигнорируйте письмо.`,
  });

  if (!result.success) {
    throw Object.assign(new Error("Не удалось отправить письмо"), {
      code: "SEND_FAILED",
    });
  }

  return { sent: true };
}

export async function confirmEmailAttach(
  userId: string,
  input: AttachEmailConfirmInput
): Promise<AttachEmailConfirmResult> {
  const key = PROFILE_EMAIL_VERIFY_PREFIX + userId;
  const stored = await redis.get(key);

  if (!stored) {
    throw Object.assign(new Error("Неверный или истёкший токен"), {
      code: "INVALID_TOKEN",
    });
  }

  const [storedToken, storedEmail] = stored.split(":");

  if (storedToken !== input.token.trim()) {
    throw Object.assign(new Error("Неверный токен"), {
      code: "INVALID_TOKEN",
    });
  }

  // Token is valid — check uniqueness again (race condition protection)
  const existingOwner = await prisma.user.findUnique({
    where: { email: storedEmail },
    select: { id: true },
  });

  if (existingOwner && existingOwner.id !== userId) {
    await redis.del(key);
    throw Object.assign(new Error("Email уже привязан к другому аккаунту"), {
      code: "EMAIL_IN_USE",
    });
  }

  // Attach email
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: storedEmail,
      emailVerified: new Date(),
    },
  });

  // Clean up
  await redis.del(key);

  return { email: storedEmail };
}

// ── ATTACH PHONE ─────────────────────────────────────────────────────────────

export async function requestPhoneAttach(
  userId: string,
  input: AttachPhoneRequestInput
): Promise<AttachPhoneRequestResult> {
  if (!isGreenApiConfigured()) {
    throw Object.assign(new Error("WhatsApp не настроен"), {
      code: "NOT_CONFIGURED",
    });
  }

  const normalized = normalizePhone(input.phone);
  if (normalized.length < 10 || normalized.length > 15) {
    throw Object.assign(new Error("Некорректный номер телефона"), {
      code: "VALIDATION_ERROR",
    });
  }

  const phoneFormatted = "+" + normalized;

  // Check if already attached to this account
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });

  if (currentUser?.phone === phoneFormatted) {
    throw Object.assign(new Error("Номер уже привязан к вашему аккаунту"), {
      code: "PHONE_ALREADY_ATTACHED",
    });
  }

  // Check if used by another account
  const existingOwner = await prisma.user.findUnique({
    where: { phone: phoneFormatted },
    select: { id: true },
  });

  if (existingOwner && existingOwner.id !== userId) {
    throw Object.assign(new Error("Номер уже привязан к другому аккаунту"), {
      code: "PHONE_IN_USE",
    });
  }

  // Cooldown check (per user, not per phone)
  const cooldownKey = PROFILE_PHONE_COOLDOWN_PREFIX + userId;
  if (redisAvailable) {
    const hasCooldown = await redis.get(cooldownKey);
    if (hasCooldown) {
      throw Object.assign(
        new Error("Подождите минуту перед повторной отправкой"),
        { code: "RATE_LIMIT" }
      );
    }
  }

  if (!redisAvailable) {
    throw Object.assign(new Error("Сервис временно недоступен"), {
      code: "SERVICE_UNAVAILABLE",
    });
  }

  // Generate OTP and store with phone
  const code = generateOTP();
  const otpKey = PROFILE_PHONE_OTP_PREFIX + userId;

  await redis.set(otpKey, `${normalized}:${code}:0`, "EX", PHONE_OTP_TTL);
  await redis.set(cooldownKey, "1", "EX", PHONE_COOLDOWN_TTL);

  const sendResult = await sendWhatsAppMessage(
    normalized,
    `Деловой Парк — код для привязки телефона: ${code}\n\nКод действителен 5 минут. Не сообщайте его никому.`
  );

  if (!sendResult.success) {
    // Rollback: clean up OTP so user can retry without waiting for TTL
    await redis.del(otpKey);
    await redis.del(cooldownKey);
    throw Object.assign(
      new Error("Не удалось отправить код. Проверьте номер и попробуйте позже."),
      { code: "SEND_FAILED" }
    );
  }

  const masked = normalized.slice(0, 4) + "***" + normalized.slice(-2);
  return { sent: true, phone: masked };
}

export async function confirmPhoneAttach(
  userId: string,
  input: AttachPhoneConfirmInput
): Promise<AttachPhoneConfirmResult> {
  const normalized = normalizePhone(input.phone);
  const otpKey = PROFILE_PHONE_OTP_PREFIX + userId;

  const stored = await redis.get(otpKey);
  if (!stored) {
    throw Object.assign(new Error("Код истёк. Запросите новый."), {
      code: "CODE_EXPIRED",
    });
  }

  const parts = stored.split(":");
  const [storedPhone, storedCode, attemptsStr] = parts;
  const attempts = parseInt(attemptsStr ?? "0", 10);

  if (attempts >= MAX_PHONE_ATTEMPTS) {
    await redis.del(otpKey);
    throw Object.assign(
      new Error("Слишком много попыток. Запросите новый код."),
      { code: "TOO_MANY_ATTEMPTS" }
    );
  }

  if (storedPhone !== normalized) {
    throw Object.assign(new Error("Неверный код"), { code: "INVALID_CODE" });
  }

  if (storedCode !== input.code.trim()) {
    // Increment attempts
    await redis.set(
      otpKey,
      `${storedPhone}:${storedCode}:${attempts + 1}`,
      "KEEPTTL"
    );
    throw Object.assign(new Error("Неверный код"), { code: "INVALID_CODE" });
  }

  // Code valid — clean up OTP
  await redis.del(otpKey);

  const phoneFormatted = "+" + normalized;

  // Race condition check
  const existingOwner = await prisma.user.findUnique({
    where: { phone: phoneFormatted },
    select: { id: true },
  });

  if (existingOwner && existingOwner.id !== userId) {
    throw Object.assign(new Error("Номер уже привязан к другому аккаунту"), {
      code: "PHONE_IN_USE",
    });
  }

  // Attach phone
  await prisma.user.update({
    where: { id: userId },
    data: { phone: phoneFormatted },
  });

  return { phone: phoneFormatted };
}
