import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { listPayments } from "@/modules/payments/service";
import { paymentsListQuerySchema } from "@/modules/payments/validation";

/**
 * GET /api/payments — список платежей для админки.
 * Доступ: SUPERADMIN/ADMIN, менеджеры — по AdminPermission section="payments".
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(
      session as { user: { id: string; role: string } } | null,
      "payments"
    );
    if (denied) return denied;

    const parsed = paymentsListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { items, total } = await listPayments(parsed.data);
    return apiResponse(items, {
      page: parsed.data.page,
      perPage: parsed.data.perPage,
      total,
    });
  } catch {
    return apiServerError();
  }
}
