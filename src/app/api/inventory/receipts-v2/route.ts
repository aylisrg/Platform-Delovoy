import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { createStockReceipt, listReceipts, InventoryError } from "@/modules/inventory/service-v2";
import { createStockReceiptSchema, receiptFilterSchema } from "@/modules/inventory/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = receiptFilterSchema.safeParse({
      supplierId: searchParams.get("supplierId") ?? undefined,
      skuId: searchParams.get("skuId") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      perPage: searchParams.get("perPage") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await listReceipts(parsed.data);
    return apiResponse(result.receipts, {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") return apiForbidden();

    const body = await request.json();
    const parsed = createStockReceiptSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await createStockReceipt(parsed.data, session.user.id);

    await logAudit(session.user.id, "inventory.receipt.create", "StockReceipt", result.receiptId, {
      itemCount: parsed.data.items.length,
      supplierId: parsed.data.supplierId,
    });

    return apiResponse(result, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
