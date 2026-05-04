import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import {
  cancelSubscription,
  SubscriptionError,
} from "@/modules/subscriptions/service";
import { cancelSubscriptionSchema } from "@/modules/subscriptions/validation";
import { mapSubscriptionError } from "../../route";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    // PRD §AC-5.1: cancel — SUPERADMIN only.
    if (!hasRole(session.user, "SUPERADMIN")) {
      return apiError("FORBIDDEN", "Отмена доступна только суперадмину", 403);
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = cancelSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
        422
      );
    }

    await cancelSubscription(id, parsed.data, session.user.id);
    return apiResponse({ id });
  } catch (err) {
    if (err instanceof SubscriptionError) return mapSubscriptionError(err);
    return apiServerError();
  }
}
