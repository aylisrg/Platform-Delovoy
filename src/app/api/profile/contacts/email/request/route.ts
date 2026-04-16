import { auth } from "@/lib/auth";
import { apiResponse, apiError } from "@/lib/api-response";
import { requestEmailAttach } from "@/modules/profile/service";
import { attachEmailRequestSchema } from "@/modules/profile/validation";

/**
 * POST /api/profile/contacts/email/request
 * Sends a verification email to attach an email address to the current account.
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

  const parsed = attachEmailRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Ошибка валидации";
    return apiError("VALIDATION_ERROR", message, 422);
  }

  try {
    const result = await requestEmailAttach(session.user.id, parsed.data);
    return apiResponse(result);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === "EMAIL_ALREADY_ATTACHED") {
      return apiError("EMAIL_ALREADY_ATTACHED", error.message, 400);
    }
    if (error.code === "EMAIL_IN_USE") {
      return apiError("EMAIL_IN_USE", error.message, 409);
    }
    if (error.code === "SEND_FAILED") {
      return apiError("SEND_FAILED", error.message, 500);
    }
    throw err;
  }
}
