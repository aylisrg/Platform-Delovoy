import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import {
  dashboardEventSchema,
  recordDashboardEvent,
} from "@/modules/analytics/dashboard-events";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const limited = await rateLimit(request, "product-event");
  if (limited) return limited;
  const parsed = dashboardEventSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return apiValidationError("Некорректное событие");
  const { event, ...metadata } = parsed.data;
  await recordDashboardEvent(session.user.id, event, metadata);
  return apiResponse({ recorded: true });
}
