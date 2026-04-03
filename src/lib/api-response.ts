import { NextResponse } from "next/server";

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: {
    page?: number;
    perPage?: number;
    total?: number;
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
