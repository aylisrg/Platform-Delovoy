import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getActiveSubscriptionForUser } from "@/modules/subscriptions/service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { userId } = await params;
    const sub = await getActiveSubscriptionForUser(userId);
    if (!sub) return apiResponse(null);
    return apiResponse({
      id: sub.id,
      totalHours: sub.totalHours.toString(),
      remainingHours: sub.remainingHours.toString(),
      validFrom: sub.validFrom.toISOString(),
      validTo: sub.validTo.toISOString(),
      status: sub.status,
    });
  } catch {
    return apiServerError();
  }
}
