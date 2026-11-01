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
import { getUserPermissions, updateUserPermissions } from "@/modules/users/section-grants";
import { permissionsUpdateSchema, userIdParamSchema } from "@/modules/users/validation";

/**
 * GET/PUT /api/admin/permissions/[userId] — the «Права» modal
 * (ADR 2026-10-25-team-access-notifications §6.2, PRD US-A4).
 *
 * The proxy lets SUPERADMIN/ADMIN/MANAGER reach /api/admin/*; this route answers
 * 403 to everyone but SUPERADMIN before any business logic.
 */

type Params = { params: Promise<{ userId: string }> };

function errorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return apiError(error.code, error.message, error.status, error.metadata);
  }
  console.error("[admin/permissions] unexpected error", error);
  return apiServerError("Ошибка обновления прав доступа");
}

export async function GET(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const userId = userIdParamSchema.safeParse((await params).userId);
  if (!userId.success) return apiValidationError("Некорректный идентификатор пользователя");

  try {
    return apiResponse(await getUserPermissions(userId.data));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const userId = userIdParamSchema.safeParse((await params).userId);
  if (!userId.success) return apiValidationError("Некорректный идентификатор пользователя");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Некорректный JSON");
  }

  const parsed = permissionsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const result = await updateUserPermissions(userId.data, parsed.data.sections, session.user.id);
    return apiResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
