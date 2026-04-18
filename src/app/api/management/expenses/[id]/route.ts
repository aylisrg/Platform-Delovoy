import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { updateExpenseSchema } from "@/modules/management/validation";
import { updateExpense, deleteExpense } from "@/modules/management/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const result = await updateExpense(id, parsed.data, session.user.id);
    if (!result.success) {
      const status = result.code === "NOT_FOUND" ? 404 : 422;
      return apiError(result.code, result.message, status);
    }

    return apiResponse(result.data);
  } catch {
    return apiServerError();
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const { id } = await context.params;
    const result = await deleteExpense(id, session.user.id);
    if (!result.success) {
      const status = result.code === "NOT_FOUND" ? 404 : 422;
      return apiError(result.code, result.message, status);
    }

    return apiResponse(result.data);
  } catch {
    return apiServerError();
  }
}
