import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError } from "@/lib/api-response";
import { listOrders } from "@/modules/cafe/service";
import { orderFilterSchema } from "@/modules/cafe/validation";

/**
 * GET /api/cafe/orders — list orders with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = orderFilterSchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { orders, total } = await listOrders(parsed.data);
    return apiResponse(orders, { total });
  } catch {
    return apiServerError();
  }
}
