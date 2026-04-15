import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getFeedbackStats } from "@/modules/feedback/service";

/**
 * GET /api/feedback/stats — feedback counters for admin dashboard (SUPERADMIN only)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const stats = await getFeedbackStats();
    return apiResponse(stats);
  } catch {
    return apiServerError();
  }
}
