import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/api-response";
import { autoCompleteExpiredSessions } from "@/modules/ps-park/service";
import { prisma } from "@/lib/db";

/**
 * POST /api/ps-park/auto-complete — finalize sessions whose endTime has passed.
 *
 * Called by system cron (every 5 minutes). Protected by CRON_SECRET Bearer
 * token, matching the convention of /api/cron/no-show et al.
 *
 * Idempotent: re-running on the same minute is safe — concurrent finalisations
 * are rejected by updateBookingStatus's status-guarded updateMany and counted
 * as "skipped".
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return apiError("UNAUTHORIZED", "Invalid or missing cron secret", 401);
  }

  // Use the first SUPERADMIN as the AuditLog actor (FK constraint requires a
  // real user id; the action is tagged actorRole=CRON in the audit metadata).
  const admin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN" },
    select: { id: true },
  });
  if (!admin) {
    return apiError("NO_CRON_ACTOR", "No SUPERADMIN user available to attribute auto-complete", 500);
  }

  const result = await autoCompleteExpiredSessions(admin.id);
  return apiResponse(result);
}
