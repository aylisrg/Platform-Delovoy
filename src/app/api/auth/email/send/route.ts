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
 * Sends a magic link to the provided email. Always returns the same
 * { success: true, sent: true } payload regardless of whether the user
 * exists, to prevent account enumeration. Credentials (email + password)
 * login is handled separately by NextAuth's /api/auth/callback/credentials.
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
    const message = parsed.error.issues[0]?.message || "Ошибка валидации";
    return apiError("VALIDATION_ERROR", message, 422);
  }

  const { email, password } = parsed.data;
  const normalized = email.toLowerCase().trim();

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
