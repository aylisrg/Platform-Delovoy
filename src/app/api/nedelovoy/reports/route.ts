import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getMonthlyReport } from "@/modules/rental/service";
import { reportQuerySchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const now = new Date();
    const params = {
      year: request.nextUrl.searchParams.get("year") ?? String(now.getFullYear()),
      month: request.nextUrl.searchParams.get("month") ?? String(now.getMonth() + 1),
    };

    const parsed = reportQuerySchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const report = await getMonthlyReport(parsed.data.year, parsed.data.month, "nedelovoy");
    return apiResponse(report);
  } catch {
    return apiServerError();
  }
}
