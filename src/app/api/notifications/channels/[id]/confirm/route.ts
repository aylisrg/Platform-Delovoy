import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
  apiError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  ChannelServiceError,
  confirmVerification,
} from "@/modules/notifications/dispatch/channels-service";
import { verifyChannelSchema } from "@/modules/notifications/dispatch/validation";
import { rateLimitCustom } from "@/modules/tasks/rate-limit";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const limited = await rateLimitCustom(
      session.user.id,
      "notif-verify-confirm",
      5,
      60
    );
    if (limited) return limited;

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = verifyChannelSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const ok = await confirmVerification(session.user.id, id, parsed.data.code);
    if (!ok) return apiError("INVALID_CODE", "Неверный код", 400);
    return apiResponse({ ok: true });
  } catch (err) {
    if (err instanceof ChannelServiceError) return apiError(err.code, err.message, 400);
    return apiServerError();
  }
}
