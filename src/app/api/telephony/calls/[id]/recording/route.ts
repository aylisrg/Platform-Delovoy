import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getCallLog, getRecordingUrl } from "@/modules/telephony/service";

/**
 * GET /api/telephony/calls/:id/recording — get recording URL for a call
 * RBAC: SUPERADMIN or MANAGER only. USER is forbidden.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const user = session.user as { id: string; role: import("@prisma/client").Role };

    // USER cannot access recordings
    if (!hasRole(user, "MANAGER")) {
      return apiForbidden("Нет доступа к записям звонков");
    }

    const { id } = await params;
    const callLog = await getCallLog(id);
    if (!callLog) return apiNotFound("Звонок не найден");

    const recordingUrl = await getRecordingUrl(id);
    if (!recordingUrl) {
      return apiError(
        "NO_RECORDING",
        callLog.status === "COMPLETED"
          ? "Запись обрабатывается"
          : "Запись недоступна",
        404
      );
    }

    return apiResponse({
      callId: id,
      recordingUrl,
      expiresAt: null,
    });
  } catch {
    return apiServerError();
  }
}
