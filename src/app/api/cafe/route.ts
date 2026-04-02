import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { getMenu, getMenuCategories } from "@/modules/cafe/service";

/**
 * GET /api/cafe — list menu items, optionally filtered by category
 */
export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get("category") ?? undefined;
    const [items, categories] = await Promise.all([
      getMenu(category),
      getMenuCategories(),
    ]);
    return apiResponse({ items, categories });
  } catch {
    return apiServerError();
  }
}
