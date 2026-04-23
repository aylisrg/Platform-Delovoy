import { NextResponse } from "next/server";

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: {
    page?: number;
    perPage?: number;
    total?: number;
    limit?: number;
    offset?: number;
  };
};

type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export function apiResponse<T>(
  data: T,
  meta?: ApiSuccessResponse<T>["meta"],
  status = 200
): NextResponse<ApiSuccessResponse<T>> {
  const body: ApiSuccessResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  return NextResponse.json(body, { status });
}

export function apiError(
  code: string,
  message: string,
  status = 400
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
    },
    { status }
  );
}

export function apiNotFound(message = "Ресурс не найден") {
  return apiError("NOT_FOUND", message, 404);
}

export function apiForbidden(message = "Доступ запрещён") {
  return apiError("FORBIDDEN", message, 403);
}

export function apiUnauthorized(message = "Необходима авторизация") {
  return apiError("UNAUTHORIZED", message, 401);
}

export function apiValidationError(message: string) {
  return apiError("VALIDATION_ERROR", message, 422);
}

export function apiServerError(message = "Внутренняя ошибка сервера") {
  return apiError("INTERNAL_ERROR", message, 500);
}

/**
 * Check if the current session has admin access to a specific section.
 * Returns null if access is granted, or an error Response if denied.
 * Usage:
 *   const denied = await requireAdminSection(session, "cafe");
 *   if (denied) return denied;
 */
export async function requireAdminSection(
  session: { user: { id: string; role: string } } | null,
  section: string
): Promise<Response | null> {
  if (!session?.user) return apiUnauthorized();

  const { role } = session.user;
  if (role === "SUPERADMIN") return null; // Full access
  if (role === "USER") return apiForbidden();

  // Dynamic import to avoid circular deps
  const { isAdminEditableModule, hasAdminSectionAccess } = await import("./permissions");

  // ADMIN owns the editable core modules (gazebos, ps-park, inventory) by role.
  if (role === "ADMIN" && isAdminEditableModule(section)) return null;

  // ADMIN (other sections) and MANAGER — require explicit AdminPermission.
  const hasAccess = await hasAdminSectionAccess(session.user.id, section);
  if (!hasAccess) {
    return apiForbidden("Нет доступа к этому разделу");
  }

  return null;
}
