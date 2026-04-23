import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { listTransactions } from "@/modules/inventory/service";
import { transactionFilterSchema } from "@/modules/inventory/validation";

/**
 * GET /api/inventory/transactions — transaction history (MANAGER, SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (
      session.user.role !== "SUPERADMIN" &&
      session.user.role !== "ADMIN" &&
      session.user.role !== "MANAGER"
    ) {
      return apiForbidden();
    }

    const { searchParams } = new URL(request.url);
    const parsed = transactionFilterSchema.safeParse(
      Object.fromEntries(searchParams.entries())
    );
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { transactions, total, page, perPage } = await listTransactions(
      parsed.data
    );

    const data = transactions.map((t) => ({
      id: t.id,
      skuId: t.skuId,
      skuName: t.sku.name,
      type: t.type,
      quantity: t.quantity,
      bookingId: t.bookingId,
      moduleSlug: t.moduleSlug,
      performedById: t.performedById,
      note: t.note,
      isVoided: t.isVoided,
      createdAt: t.createdAt,
    }));

    return apiResponse(data, { total, page, perPage });
  } catch {
    return apiServerError();
  }
}
