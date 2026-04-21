import { auth } from "@/lib/auth";
import { apiResponse, apiError } from "@/lib/api-response";
import { attachPhone } from "@/modules/profile/service";
import { attachPhoneConfirmSchema } from "@/modules/profile/validation";

/**
 * POST /api/profile/contacts/phone/confirm
 * Verifies the OTP and attaches the phone number to the current account.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError("UNAUTHORIZED", "Необходимо войти в аккаунт", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Некорректный запрос", 400);
  }

  const parsed = attachPhoneConfirmSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Ошибка валидации";
    return apiError("VALIDATION_ERROR", message, 422);
  }

  try {
    const result = await attachPhone(session.user.id, parsed.data);
    return apiResponse(result);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === "CODE_EXPIRED") {
      return apiError("CODE_EXPIRED", error.message, 410);
    }
    if (error.code === "INVALID_CODE") {
      return apiError("INVALID_CODE", error.message, 400);
    }
    if (error.code === "TOO_MANY_ATTEMPTS") {
      return apiError("TOO_MANY_ATTEMPTS", error.message, 429);
    }
    if (error.code === "PHONE_IN_USE") {
      return apiError("PHONE_IN_USE", error.message, 409);
    }
    throw err;
  }
}
