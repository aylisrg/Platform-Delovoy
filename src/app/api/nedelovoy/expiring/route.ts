import { NextRequest } from "next/server";
import { apiResponse, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getExpiringContracts } from "@/modules/rental/service";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    const contracts = await getExpiringContracts(isNaN(days) ? 30 : days, "nedelovoy");
    return apiResponse(contracts);
  } catch {
    return apiServerError();
  }
}
