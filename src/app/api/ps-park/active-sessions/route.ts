import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getActiveSessions } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park/active-sessions
 * Returns currently in-progress sessions (CONFIRMED + startTime <= now < endTime).
 * Used for 30s polling by ActiveSessionsPanel.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const sessions = await getActiveSessions();
    return apiResponse(sessions);
  } catch {
    return apiServerError();
  }
}
