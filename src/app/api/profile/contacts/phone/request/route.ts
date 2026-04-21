import { auth } from "@/lib/auth";
import { apiResponse, apiError } from "@/lib/api-response";
import { attachPhone } from "@/modules/profile/service";
import { attachPhoneRequestSchema } from "@/modules/profile/validation";

/**
 * POST /api/profile/contacts/phone/request
 * Directly attaches a phone number to the current user account.
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

  const parsed = attachPhoneRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Ошибка валидации";
    return apiError("VALIDATION_ERROR", message, 422);
  }

  try {
    const result = await attachPhone(session.user.id, parsed.data);
    return apiResponse(result);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === "PHONE_ALREADY_ATTACHED") {
      return apiError("PHONE_ALREADY_ATTACHED", error.message, 400);
    }
    if (error.code === "PHONE_IN_USE") {
      return apiError("PHONE_IN_USE", error.message, 409);
    }
    if (error.code === "VALIDATION_ERROR") {
      return apiError("VALIDATION_ERROR", error.message, 422);
    }
    throw err;
  }
}
