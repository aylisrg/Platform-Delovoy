import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { updateRecurringExpenseSchema } from "@/modules/management/validation";
import {
  updateRecurringExpense,
  deleteRecurringExpense,
} from "@/modules/management/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateRecurringExpenseSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const updated = await updateRecurringExpense(id, parsed.data, session.user.id);
    if (!updated) return apiNotFound("Recurring расход не найден");

    return apiResponse(updated);
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
    const deleted = await deleteRecurringExpense(id, session.user.id);
    if (!deleted) return apiNotFound("Recurring расход не найден");

    return apiResponse({ id: deleted.id, deletedAt: deleted.deletedAt });
  } catch {
    return apiServerError();
  }
}
