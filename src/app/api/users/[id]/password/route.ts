import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiForbidden, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { resetPasswordSchema } from "@/modules/users/validation";
import { resetUserPassword } from "@/modules/users/service";

/**
 * PATCH /api/users/[id]/password
 * Reset a user's password. SUPERADMIN only.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join(", ");
      return apiValidationError(message);
    }

    await resetUserPassword(id, parsed.data.password);
    return apiResponse({ reset: true });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return apiError("NOT_FOUND", "Пользователь не найден", 404);
    }
    return apiError("INTERNAL_ERROR", "Ошибка сброса пароля", 500);
  }
}
