import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { sendEmailSchema } from "@/modules/rental/validation";
import { sendManualEmail, RentalEmailError } from "@/modules/rental/notifications";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const rl = await rateLimit(request, "authenticated");
    if (rl) return rl;

    const userId = session!.user.id;
    const body = await request.json();
    const parsed = sendEmailSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await sendManualEmail({
      ...parsed.data,
      sentById: userId,
    });

    await logAudit(userId, "email.sent", "Tenant", parsed.data.tenantId, {
      contractId: parsed.data.contractId,
      templateKey: parsed.data.templateKey,
      sentCount: result.sent.length,
      failedCount: result.failed.length,
    });

    return apiResponse(result);
  } catch (err) {
    if (err instanceof RentalEmailError) {
      return apiError(err.code, err.message, 422);
    }
    console.error("[POST /api/rental/send-email]", err);
    return apiServerError();
  }
}
