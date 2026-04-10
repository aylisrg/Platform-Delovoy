import { redis, redisAvailable } from "@/lib/redis";
import { prisma } from "@/lib/db";
import { apiResponse, apiError } from "@/lib/api-response";

const OTP_PREFIX = "whatsapp:otp:";
const OTP_ATTEMPTS_PREFIX = "whatsapp:attempts:";
const MAX_ATTEMPTS = 5;

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("8") && digits.length === 11
    ? "7" + digits.slice(1)
    : digits;
}

/**
 * POST /api/auth/whatsapp/verify — verify OTP and return session token
 */
export async function POST(request: Request) {
  if (!redisAvailable) {
    return apiError("SERVICE_UNAVAILABLE", "Сервис временно недоступен", 503);
  }

  let body: { phone?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Некорректный запрос", 400);
  }

  const { phone, code } = body;
  if (!phone || !code) {
    return apiError("VALIDATION_ERROR", "Укажите номер телефона и код", 422);
  }

  const normalized = normalizePhone(phone);
  const otpKey = OTP_PREFIX + normalized;
  const attemptsKey = OTP_ATTEMPTS_PREFIX + normalized;

  // Check attempts
  const attempts = parseInt(await redis.get(attemptsKey) || "0", 10);
  if (attempts >= MAX_ATTEMPTS) {
    await redis.del(otpKey);
    await redis.del(attemptsKey);
    return apiError("TOO_MANY_ATTEMPTS", "Слишком много попыток. Запросите новый код.", 429);
  }

  // Get stored OTP
  const storedCode = await redis.get(otpKey);
  if (!storedCode) {
    return apiError("CODE_EXPIRED", "Код истёк. Запросите новый.", 410);
  }

  // Verify
  if (storedCode !== code.trim()) {
    await redis.incr(attemptsKey);
    return apiError("INVALID_CODE", "Неверный код", 400);
  }

  // Code is valid — clean up
  await redis.del(otpKey);
  await redis.del(attemptsKey);

  // Find or create user by phone
  const phoneFormatted = "+" + normalized;
  let user = await prisma.user.findUnique({
    where: { phone: phoneFormatted },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: phoneFormatted,
        role: "USER",
      },
    });
  }

  return apiResponse({
    verified: true,
    userId: user.id,
    role: user.role,
  });
}
