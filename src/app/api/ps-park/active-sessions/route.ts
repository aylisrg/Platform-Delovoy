import { apiResponse, apiServerError } from "@/lib/api-response";
import { getActiveSessions } from "@/modules/ps-park/service";

/**
 * GET /api/ps-park/active-sessions
 * Returns currently in-progress sessions (CONFIRMED + startTime <= now < endTime).
 * Used for 30s polling by ActiveSessionsPanel.
 */
export async function GET() {
  try {
    const sessions = await getActiveSessions();
    return apiResponse(sessions);
  } catch {
    return apiServerError();
  }
}
