import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError } from "@/lib/api-response";
import { getAvailability } from "@/modules/gazebos/service";
import { availabilityQuerySchema } from "@/modules/gazebos/validation";

/**
 * GET /api/gazebos/availability?date=YYYY-MM-DD&resourceId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = availabilityQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const availability = await getAvailability(parsed.data.date, parsed.data.resourceId);
    return apiResponse(availability);
  } catch {
    return apiServerError();
  }
}
