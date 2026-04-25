import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { searchOffices } from "@/modules/rental/service";
import { searchOfficeSchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/offices/search?q=<query>
 *
 * Lightweight, public-safe office lookup for autocompletes (e.g. the
 * feedback form combobox). Open to any authenticated user — returns
 * only `id, number, building, floor, status`, no pricing or contracts.
 *
 * Use the heavier MANAGER-only `/api/rental/offices` for admin lists.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = searchOfficeSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const offices = await searchOffices(parsed.data.q);
    return apiResponse(offices);
  } catch {
    return apiServerError();
  }
}
