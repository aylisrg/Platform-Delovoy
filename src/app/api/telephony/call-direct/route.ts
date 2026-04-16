import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { initiateDirectCall, TelephonyError } from "@/modules/telephony/service";
import { initiateDirectCallSchema } from "@/modules/telephony/validation";

/**
 * POST /api/telephony/call-direct
 * Initiate a direct outbound call to any phone number (e.g. tenant contact).
 * RBAC: MANAGER or SUPERADMIN
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const role = session.user.role;
    if (role !== "SUPERADMIN" && role !== "MANAGER") {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }

    const body = await request.json();
    const parsed = initiateDirectCallSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Некорректные данные",
        422
      );
    }

    const { phone, tenantId, context } = parsed.data;

    const callLog = await initiateDirectCall(session.user.id, phone, {
      tenantId,
      context,
    });

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
    console.error("[telephony/call-direct] Error:", error);
    return apiServerError();
  }
}
