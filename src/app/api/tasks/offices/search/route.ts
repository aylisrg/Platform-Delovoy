import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { matchOffice } from "@/modules/tasks/office-matcher";
import { OfficeSearchSchema } from "@/modules/tasks/validation";

/**
 * GET /api/tasks/offices/search?q=...
 *
 * Public endpoint powering the /report form's office autosuggest.
 * Runs the free-form input through the office matcher and returns up to 8
 * candidates. Rate-limited by IP.
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await rateLimit(request, "public");
    if (limited) return limited;

    const parsed = OfficeSearchSchema.safeParse({
      q: request.nextUrl.searchParams.get("q") ?? "",
    });
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const offices = await prisma.office.findMany({
      select: { id: true, number: true, building: true, floor: true },
    });

    const result = matchOffice(parsed.data.q, offices, { maxCandidates: 8 });

    // Minimize surface: don't leak internal metadata. Just id/number/building/floor.
    const payload = {
      exact: result.exact
        ? {
            id: result.exact.id,
            number: result.exact.number,
            building: result.exact.building,
            floor: result.exact.floor,
          }
        : null,
      candidates: result.candidates.map((o) => ({
        id: o.id,
        number: o.number,
        building: o.building,
        floor: o.floor,
      })),
    };

    return apiResponse(payload);
  } catch (err) {
    console.error("[GET /api/tasks/offices/search]", err);
    return apiServerError();
  }
}
