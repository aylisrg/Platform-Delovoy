import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { sendSms, TelephonyError } from "@/modules/telephony/service";
import { sendSmsSchema } from "@/modules/telephony/validation";

/**
 * POST /api/telephony/sms
 * Send an SMS to a phone number (e.g. tenant contact).
 * RBAC: MANAGER or SUPERADMIN
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const role = session.user.role;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") {
      return apiError("FORBIDDEN", "Недостаточно прав", 403);
    }

    const body = await request.json();
    const parsed = sendSmsSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Некорректные данные",
        422
      );
    }

    const { phone, message, tenantId } = parsed.data;

    const smsLog = await sendSms(session.user.id, phone, message, { tenantId });

    return apiResponse({
      smsId: smsLog.id,
      status: smsLog.status,
      externalId: smsLog.externalId,
      clientPhone: smsLog.clientPhone,
    });
  } catch (error) {
    if (error instanceof TelephonyError) {
      return apiError(error.code, error.message, error.httpStatus);
    }
    console.error("[telephony/sms] Error:", error);
    return apiServerError();
  }
}
