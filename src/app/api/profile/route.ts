import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { getProfile, updateName } from "@/modules/profile/service";
import { updateNameSchema } from "@/modules/profile/validation";

/**
 * GET /api/profile
 * Returns the current user's profile with contact info.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError("UNAUTHORIZED", "Необходимо войти в аккаунт", 401);
  }

  try {
    return apiResponse(await getProfile(session.user.id));
  } catch {
    return apiServerError("Не удалось загрузить профиль");
  }
}

/**
 * PATCH /api/profile
 * Updates the current user's display name.
 */
export async function PATCH(request: Request) {
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

  const parsed = updateNameSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Ошибка валидации";
    return apiError("VALIDATION_ERROR", message, 422);
  }

  const result = await updateName(session.user.id, parsed.data);
  return apiResponse(result);
}
