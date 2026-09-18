import { apiResponse, apiError } from "@/lib/api-response";
import { sendMagicLinkSchema } from "@/modules/auth/validation";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
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

  const { email, password, callbackUrl } = parsed.data;
  const normalized = email.toLowerCase().trim();

  // Адрес возврата приходит из query-строки страницы входа, то есть от того,
  // кто прислал ссылку. Нормализуем ЗДЕСЬ, до записи: в Redis должен лечь
  // только свой путь, иначе письмо превратилось бы в инструмент увода на
  // чужой домен. Чужое значение молча отбрасываем — вход всё равно сработает,
  // просто по роли.
  const appUrl =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const safeTarget = safeCallbackUrl(callbackUrl, appUrl);

  const canSend = await canSendMagicLink(normalized);
  if (!canSend) {
    return apiError(
      "RATE_LIMIT",
      "Подождите минуту перед повторной отправкой",
      429
    );
  }

  try {
    const token = await generateAndStoreMagicLink(normalized, password, safeTarget);
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
