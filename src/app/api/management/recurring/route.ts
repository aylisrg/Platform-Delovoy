import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import {
  createRecurringExpenseSchema,
  recurringFilterSchema,
} from "@/modules/management/validation";
import {
  listRecurringExpenses,
  createRecurringExpense,
} from "@/modules/management/service";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = recurringFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const result = await listRecurringExpenses(parsed.data);
    return apiResponse(result.data, result.meta);
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN")
      return apiForbidden("Доступ только для администратора");

    const body = await request.json();
    const parsed = createRecurringExpenseSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0].message, 422);
    }

    const record = await createRecurringExpense(parsed.data, session.user.id);
    return apiResponse(record, undefined, 201);
  } catch {
    return apiServerError();
  }
}
