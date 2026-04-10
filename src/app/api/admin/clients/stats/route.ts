import { apiResponse, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getClientStats } from "@/modules/clients/service";

/**
 * GET /api/admin/clients/stats — aggregate client statistics.
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "clients");
    if (denied) return denied;

    const stats = await getClientStats();
    return apiResponse(stats);
  } catch (error) {
    console.error("[Admin Clients] Stats error:", error);
    return apiServerError();
  }
}
