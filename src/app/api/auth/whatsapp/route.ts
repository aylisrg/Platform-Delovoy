import crypto from "crypto";
import { redis, redisAvailable } from "@/lib/redis";
import { sendWhatsAppMessage, isGreenApiConfigured } from "@/lib/green-api";
import { apiResponse, apiError } from "@/lib/api-response";

const OTP_TTL = 300; // 5 minutes
const OTP_PREFIX = "whatsapp:otp:";
const OTP_ATTEMPTS_PREFIX = "whatsapp:attempts:";
const MAX_ATTEMPTS = 5; // max verification attempts per code
const COOLDOWN_PREFIX = "whatsapp:cooldown:";
const COOLDOWN_TTL = 60; // 1 minute between sends

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("8") && digits.length === 11
    ? "7" + digits.slice(1)
    : digits;
}

function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * POST /api/auth/whatsapp — send OTP code via WhatsApp
 */
export async function POST(request: Request) {
  if (!isGreenApiConfigured()) {
    return apiError("NOT_CONFIGURED", "WhatsApp авторизация не настроена", 503);
  }

  if (!redisAvailable) {
    return apiError("SERVICE_UNAVAILABLE", "Сервис временно недоступен", 503);
  }

  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Некорректный запрос", 400);
  }

  const { phone } = body;
  if (!phone) {
    return apiError("VALIDATION_ERROR", "Укажите номер телефона", 422);
  }

  const normalized = normalizePhone(phone);
  if (normalized.length < 10 || normalized.length > 15) {
    return apiError("VALIDATION_ERROR", "Некорректный номер телефона", 422);
  }

  // Cooldown check
  const cooldownKey = COOLDOWN_PREFIX + normalized;
  const hasCooldown = await redis.get(cooldownKey);
  if (hasCooldown) {
    return apiError("RATE_LIMIT", "Подождите минуту перед повторной отправкой", 429);
  }

  // Generate and store OTP
  const code = generateOTP();
  const otpKey = OTP_PREFIX + normalized;
  const attemptsKey = OTP_ATTEMPTS_PREFIX + normalized;

  await redis.set(otpKey, code, "EX", OTP_TTL);
  await redis.set(attemptsKey, "0", "EX", OTP_TTL);
  await redis.set(cooldownKey, "1", "EX", COOLDOWN_TTL);

  // Send via WhatsApp
  const result = await sendWhatsAppMessage(
    normalized,
    `Деловой Парк — ваш код для входа: ${code}\n\nКод действителен 5 минут. Не сообщайте его никому.`
  );

  if (!result.success) {
    console.error("[WhatsApp OTP] Send failed:", result.error);
    return apiError("SEND_FAILED", "Не удалось отправить код. Проверьте номер и попробуйте позже.", 500);
  }

  return apiResponse({ sent: true, phone: normalized.slice(0, 4) + "***" + normalized.slice(-2) });
}
