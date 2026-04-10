import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiForbidden, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { updateUserSchema } from "@/modules/users/validation";
import { updateUser, deleteUser, getUser } from "@/modules/users/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  try {
    const user = await getUser(id);
    return apiResponse(user);
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return apiError("NOT_FOUND", "Пользователь не найден", 404);
    }
    return apiError("INTERNAL_ERROR", "Ошибка загрузки пользователя", 500);
  }
}

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
    const parsed = updateUserSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join(", ");
      return apiValidationError(message);
    }

    const user = await updateUser(id, parsed.data, session.user.id);
    return apiResponse(user);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CANNOT_DEMOTE_SELF") {
        return apiError("CANNOT_DEMOTE_SELF", "Нельзя понизить роль самому себе", 400);
      }
      if (error.message === "USER_NOT_FOUND") {
        return apiError("NOT_FOUND", "Пользователь не найден", 404);
      }
    }
    return apiError("INTERNAL_ERROR", "Ошибка обновления пользователя", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  try {
    await deleteUser(id, session.user.id);
    return apiResponse({ deleted: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CANNOT_DELETE_SELF") {
        return apiError("CANNOT_DELETE_SELF", "Нельзя удалить самого себя", 400);
      }
      if (error.message === "USER_NOT_FOUND") {
        return apiError("NOT_FOUND", "Пользователь не найден", 404);
      }
    }
    return apiError("INTERNAL_ERROR", "Ошибка удаления пользователя", 500);
  }
}
