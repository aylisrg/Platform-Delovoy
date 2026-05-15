import { apiResponse, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getOccupancyReport } from "@/modules/rental/service";

export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const report = await getOccupancyReport("nedelovoy");
    return apiResponse(report);
  } catch {
    return apiServerError();
  }
}
