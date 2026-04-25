import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchSkus } from "@/lib/sku-search";

/**
 * GET /api/inventory/sku/search?q=<query>
 * Fuzzy SKU search with transliteration.
 * Returns up to 6 candidates ranked by similarity.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const q = new URL(request.url).searchParams.get("q") ?? "";
    if (!q || q.trim().length < 2) {
      return apiValidationError("Запрос должен содержать минимум 2 символа");
    }

    const skus = await prisma.inventorySku.findMany({
      where: { isActive: true },
      select: { id: true, name: true, category: true, unit: true, stockQuantity: true },
    });

    const results = searchSkus(q, skus.map((s) => ({ ...s, stockQuantity: Number(s.stockQuantity) })));

    return apiResponse(results, { total: results.length });
  } catch {
    return apiServerError();
  }
}
