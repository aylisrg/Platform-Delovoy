import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { DomainError } from "@/modules/users/errors";
import { updateUserSchema } from "@/modules/users/validation";
import { updateUser, deleteUser, getUser } from "@/modules/users/service";

type Params = { params: Promise<{ id: string }> };

function errorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof DomainError) {
    return apiError(error.code, error.message, error.status, error.metadata);
  }
  console.error("[users/:id] unexpected error", error);
  return apiServerError(fallbackMessage);
}

export async function GET(_request: Request, { params }: Params) {
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

/**
 * PATCH /api/users/[id] — role and profile fields. A change to USER runs the
 * same exclusion as «Исключить из команды» (AC-A2.1) and the response carries
 * `exclusion`; demotions revoke sessions (AC-A2.2). ADR 2026-10-25 §6.2.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Некорректный JSON");
  }

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(", ");
    return apiValidationError(message);
  }

  try {
    const user = await updateUser(id, parsed.data, session.user.id);
    return apiResponse(user);
  } catch (error) {
    return errorResponse(error, "Ошибка обновления пользователя");
  }
}

/**
 * DELETE /api/users/[id] — only accounts without history. Otherwise
 * 409 USER_HAS_HISTORY with `metadata: { blockers, isTeamMember }` (AC-A3.1).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  try {
    await deleteUser(id, session.user.id);
    return apiResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error, "Ошибка удаления пользователя");
  }
}
