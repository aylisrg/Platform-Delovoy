import { prisma } from "@/lib/db";
import { apiResponse, apiError } from "@/lib/api-response";
import { sendMagicLinkSchema } from "@/modules/auth/validation";
import {
  canSendMagicLink,
  generateAndStoreMagicLink,
  sendMagicLinkEmail,
} from "@/modules/auth/email-magic-link.service";

/**
 * POST /api/auth/email/send
 *
 * Triggers the magic link flow:
 * - If user exists with a passwordHash → return USE_PASSWORD (credentials login)
 * - Otherwise → generate + send magic link
 *
 * Always returns { sent: true } on success (even for new users) to prevent
 * email enumeration.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Некорректный запрос", 400);
  }

  const parsed = sendMagicLinkSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors[0]?.message || "Ошибка валидации";
    return apiError("VALIDATION_ERROR", message, 422);
  }

  const { email, password } = parsed.data;
  const normalized = email.toLowerCase().trim();

  // Check if user already has a password (don't hijack credentials login)
  const existingUser = await prisma.user.findUnique({
    where: { email: normalized },
    select: { passwordHash: true },
  });

  if (existingUser?.passwordHash) {
    // User has a password — tell client to use credentials flow
    return apiError(
      "USE_PASSWORD",
      "Используйте email и пароль для входа",
      200
    );
  }

  // Cooldown check
  const canSend = await canSendMagicLink(normalized);
  if (!canSend) {
    return apiError(
      "RATE_LIMIT",
      "Подождите минуту перед повторной отправкой",
      429
    );
  }

  try {
    const token = await generateAndStoreMagicLink(normalized, password);
    await sendMagicLinkEmail(normalized, token);
  } catch (err) {
    console.error("[Magic Link] Send failed:", err);
    return apiError(
      "SEND_FAILED",
      "Не удалось отправить письмо. Попробуйте позже.",
      500
    );
  }

  return apiResponse({ sent: true });
}
