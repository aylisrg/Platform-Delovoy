import { NextRequest, NextResponse } from "next/server";
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
import { listAllSkus, createSku, InventoryError } from "@/modules/inventory/service";
import { createSkuSchema, skuFilterSchema } from "@/modules/inventory/validation";

/**
 * GET /api/inventory/sku — all SKUs including inactive (SUPERADMIN)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { searchParams } = new URL(request.url);
    const parsed = skuFilterSchema.safeParse({
      category: searchParams.get("category") ?? undefined,
      isActive: searchParams.get("isActive") ?? undefined,
    });

    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const skus = await listAllSkus(parsed.data);
    return apiResponse(skus, { total: skus.length });
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/inventory/sku — create SKU (SUPERADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const body = await request.json();
    const parsed = createSkuSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const sku = await createSku(parsed.data, session.user.id);

    await logAudit(session.user.id, "inventory.sku.create", "InventorySku", sku.id, {
      name: sku.name,
      category: sku.category,
      price: sku.price,
      initialStock: parsed.data.initialStock,
    });

    return apiResponse(sku, undefined, 201);
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.code === "SKU_DUPLICATE") {
        return NextResponse.json(
          { success: false, error: { code: "SKU_DUPLICATE", message: error.message, ...error.meta } },
          { status: 409 }
        );
      }
      return apiError(error.code, error.message);
    }
    console.error("[API] POST /api/inventory/sku error:", error instanceof Error ? error.message : String(error));
    return apiServerError();
  }
}
