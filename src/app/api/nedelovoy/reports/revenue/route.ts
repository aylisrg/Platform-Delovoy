import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getRevenueReport } from "@/modules/rental/service";
import { revenueReportSchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = revenueReportSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const report = await getRevenueReport(parsed.data.building, "nedelovoy");
    return apiResponse(report);
  } catch {
    return apiServerError();
  }
}
