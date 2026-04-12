import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/api-response";
import { findAutoNoShowCandidates } from "@/modules/booking/checkin";
import { markNoShow as markNoShowPS, PSBookingError } from "@/modules/ps-park/service";
import { markNoShow as markNoShowGazebos, BookingError } from "@/modules/gazebos/service";

const MODULES = ["ps-park", "gazebos"] as const;

/**
 * GET /api/cron/no-show — auto-mark CONFIRMED bookings as NO_SHOW
 * Called by system cron every 5 minutes.
 * Protected by Bearer token (CRON_SECRET env var).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return apiError("UNAUTHORIZED", "Invalid or missing cron secret", 401);
  }

  const results: Record<string, { processed: number; errors: string[] }> = {};

  for (const moduleSlug of MODULES) {
    const processed: string[] = [];
    const errors: string[] = [];

    const candidateIds = await findAutoNoShowCandidates(moduleSlug, 30);

    for (const bookingId of candidateIds) {
      try {
        if (moduleSlug === "ps-park") {
          await markNoShowPS(bookingId, "cron", "auto");
        } else {
          await markNoShowGazebos(bookingId, "cron", "auto");
        }
        processed.push(bookingId);
      } catch (err) {
        if (err instanceof PSBookingError || err instanceof BookingError) {
          errors.push(`${bookingId}: ${err.message}`);
        } else {
          errors.push(`${bookingId}: unknown error`);
        }
      }
    }

    results[moduleSlug] = { processed: processed.length, errors };
  }

  return apiResponse({
    processedAt: new Date().toISOString(),
    modules: results,
  });
}
