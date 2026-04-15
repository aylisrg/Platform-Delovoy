import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError } from "@/lib/api-response";
import { getTimeline } from "@/modules/gazebos/service";
import { timelineQuerySchema } from "@/modules/gazebos/validation";

/**
 * GET /api/gazebos/timeline?date=YYYY-MM-DD
 * Returns resources + bookings for a given date, optimized for the timeline grid.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = timelineQuerySchema.safeParse({
      date: searchParams.get("date") ?? "",
    });

    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const data = await getTimeline(parsed.data.date);
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}
