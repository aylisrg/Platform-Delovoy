import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { initiateCall, TelephonyError } from "@/modules/telephony/service";
import { initiateCallSchema } from "@/modules/telephony/validation";

/**
 * POST /api/telephony/call — initiate outbound click-to-call
 * RBAC: MANAGER (gazebos/ps-park) or SUPERADMIN
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const body = await request.json();
    const parsed = initiateCallSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Некорректные данные", 422);
    }

    const { bookingId, moduleSlug } = parsed.data;

    // Check section access for the relevant module
    const denied = await requireAdminSection(session, moduleSlug);
    if (denied) return denied;

    const callLog = await initiateCall(session.user.id, bookingId, moduleSlug);

    return apiResponse({
      callId: callLog.id,
      status: callLog.status,
      externalCallId: callLog.externalCallId,
      clientPhone: callLog.clientPhone,
    });
  } catch (error) {
    if (error instanceof TelephonyError) {
      return apiError(error.code, error.message, error.httpStatus);
    }
    console.error("[telephony/call] Error:", error);
    return apiServerError();
  }
}
