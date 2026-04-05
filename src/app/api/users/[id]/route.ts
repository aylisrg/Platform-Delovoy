import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiForbidden, apiUnauthorized } from "@/lib/api-response";
import { deleteUser } from "@/modules/users/service";

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
