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
import { hasModuleAccess, getUserModules } from "@/lib/permissions";
import { createStockReceipt, listReceipts, InventoryError } from "@/modules/inventory/service-v2";
import { createStockReceiptSchema, receiptFilterSchema } from "@/modules/inventory/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = receiptFilterSchema.safeParse({
      supplierId: searchParams.get("supplierId") ?? undefined,
      skuId: searchParams.get("skuId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      moduleSlug: searchParams.get("moduleSlug") ?? undefined,
      performedById: searchParams.get("performedById") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      perPage: searchParams.get("perPage") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const filter: Parameters<typeof listReceipts>[0] = { ...parsed.data };

    if (role === "MANAGER") {
      // MANAGER sees only their own receipts
      filter.performedById = session.user.id;
    } else if (role === "ADMIN") {
      // ADMIN sees all receipts in their assigned modules
      const userModules = await getUserModules(session.user.id);
      const warehouseModules = userModules.filter((m) =>
        ["cafe", "bbq", "ps-park"].includes(m)
      );
      if (parsed.data.moduleSlug && warehouseModules.includes(parsed.data.moduleSlug)) {
        filter.moduleSlug = parsed.data.moduleSlug;
      } else if (!parsed.data.moduleSlug) {
        filter.moduleSlugs = warehouseModules;
      }
    }
    // SUPERADMIN: no restrictions

    const result = await listReceipts(filter);
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

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const body = await request.json();
    const parsed = createStockReceiptSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    // Verify module access
    if (parsed.data.moduleSlug && role !== "SUPERADMIN") {
      const allowed = await hasModuleAccess(session.user.id, parsed.data.moduleSlug);
      if (!allowed) return apiForbidden();
    }

    const result = await createStockReceipt(parsed.data, session.user.id);

    await logAudit(session.user.id, "inventory.receipt.create", "StockReceipt", result.receiptId, {
      itemCount: parsed.data.items.length,
      supplierId: parsed.data.supplierId,
      moduleSlug: parsed.data.moduleSlug,
    });

    return apiResponse(result, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
