import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  createSubscription,
  listSubscriptions,
  SubscriptionError,
} from "@/modules/subscriptions/service";
import {
  createSubscriptionSchema,
  listSubscriptionsSchema,
} from "@/modules/subscriptions/validation";

function mapSubscriptionError(err: SubscriptionError) {
  const codeMap: Record<string, number> = {
    USER_NOT_FOUND: 404,
    SUBSCRIPTION_NOT_FOUND: 404,
    INVALID_USER_ROLE: 422,
    INSUFFICIENT_HOURS: 422,
    ACTIVE_SUBSCRIPTION_EXISTS: 409,
    SUBSCRIPTION_NOT_ACTIVE: 409,
    ALREADY_CANCELLED: 409,
  };
  return apiError(
    err.code,
    err.message,
    codeMap[err.code] ?? 400,
    err.metadata
  );
}

export async function GET(request: NextRequest) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const parsed = listSubscriptionsSchema.safeParse(params);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
        422
      );
    }

    const result = await listSubscriptions(parsed.data);
    return apiResponse(result);
  } catch (err) {
    if (err instanceof SubscriptionError) return mapSubscriptionError(err);
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const body = await request.json();
    const parsed = createSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
        422
      );
    }

    const result = await createSubscription(parsed.data, session.user.id);
    return apiResponse(result, undefined, 201);
  } catch (err) {
    if (err instanceof SubscriptionError) return mapSubscriptionError(err);
    return apiServerError();
  }
}

export { mapSubscriptionError };
