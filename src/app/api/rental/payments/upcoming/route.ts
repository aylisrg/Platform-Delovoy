import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { upcomingPaymentsQuerySchema } from "@/modules/rental/validation";
import { listUpcomingPayments } from "@/modules/rental/payments";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = upcomingPaymentsQuerySchema.safeParse(queryParams);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const payments = await listUpcomingPayments(parsed.data.withinDays);
    return apiResponse(payments);
  } catch {
    return apiServerError();
  }
}
