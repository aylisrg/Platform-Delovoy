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
import { canConfirmReceipt, hasModuleAccess, getUserModules } from "@/lib/permissions";
import {
  createStockReceipt,
  confirmReceipt,
  listReceipts,
  InventoryError,
} from "@/modules/inventory/service-v2";
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

    // Auto-confirm when the author is also allowed to confirm — SUPERADMIN always,
    // ADMIN with access to the module. Otherwise (MANAGER, или ADMIN без модуля)
    // приход остаётся в DRAFT и ждёт подтверждения.
    //
    // Без этого SUPERADMIN добавлял позиции, но stockQuantity не увеличивался,
    // потому что остатки пересчитываются только в confirmReceipt.
    const moduleSlugForPerms = parsed.data.moduleSlug ?? "cafe";
    const canAutoConfirm = await canConfirmReceipt(
      { id: session.user.id, role },
      moduleSlugForPerms
    );

    if (canAutoConfirm) {
      try {
        const confirmed = await confirmReceipt(result.receiptId, session.user.id);
        await logAudit(
          session.user.id,
          "inventory.receipt.confirm",
          "StockReceipt",
          result.receiptId,
          { batchIds: confirmed.batchIds, autoConfirmed: true }
        );
        return apiResponse(
          { ...result, status: confirmed.status, batchIds: confirmed.batchIds, autoConfirmed: true },
          undefined,
          201
        );
      } catch (err) {
        // Подтверждение упало — отдаём DRAFT-ответ плюс поле ошибки,
        // чтобы UI показал вменяемое сообщение, а не пустое "успех".
        if (err instanceof InventoryError) {
          return apiResponse(
            { ...result, autoConfirmed: false, confirmError: err.message },
            undefined,
            201
          );
        }
        throw err;
      }
    }

    return apiResponse({ ...result, autoConfirmed: false }, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) return apiError(error.code, error.message);
    return apiServerError();
  }
}
