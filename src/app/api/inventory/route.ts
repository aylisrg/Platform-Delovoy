import { apiResponse, apiServerError } from "@/lib/api-response";
import { listPublicSkus } from "@/modules/inventory/service";

/**
 * GET /api/inventory — public list of active SKUs with stock
 */
export async function GET() {
  try {
    const skus = await listPublicSkus();

    const data = skus.map((sku) => ({
      ...sku,
      outOfStock: sku.stockQuantity === 0,
    }));

    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
