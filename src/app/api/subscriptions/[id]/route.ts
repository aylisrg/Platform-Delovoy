import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  getSubscription,
  updateSubscription,
  SubscriptionError,
} from "@/modules/subscriptions/service";
import { updateSubscriptionSchema } from "@/modules/subscriptions/validation";
import { mapSubscriptionError } from "../route";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { id } = await params;
    const sub = await getSubscription(id);
    if (!sub) return apiNotFound("Абонемент не найден");
    return apiResponse(sub);
  } catch (err) {
    if (err instanceof SubscriptionError) return mapSubscriptionError(err);
    return apiServerError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
        422
      );
    }

    await updateSubscription(id, parsed.data, session.user.id);
    return apiResponse({ id });
  } catch (err) {
    if (err instanceof SubscriptionError) return mapSubscriptionError(err);
    return apiServerError();
  }
}
