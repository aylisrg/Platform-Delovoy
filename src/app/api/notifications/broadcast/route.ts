import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { broadcastToSegment, getCampaigns } from "@/modules/notifications/cohorts/broadcast";
import { broadcastSchema } from "@/modules/notifications/cohorts/validation";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "notifications");
    if (denied) return denied;

    // Only SUPERADMIN may broadcast
    if (session!.user.role !== "SUPERADMIN") {
      return apiError("FORBIDDEN", "Только суперадмин может отправлять рассылки", 403);
    }

    // Per-user rate limit: max 5 broadcasts/min to prevent accidental double-send
    const limited = await rateLimit(request, "authenticated", session.user.id);
    if (limited) return limited;

    const body = await request.json();
    const parsed = broadcastSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const result = await broadcastToSegment(parsed.data, session!.user.id);
    return apiResponse(result, 200);
  } catch (err) {
    return apiServerError(err);
  }
}

export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "notifications");
    if (denied) return denied;

    const campaigns = await getCampaigns(20);
    return apiResponse(campaigns);
  } catch (err) {
    return apiServerError(err);
  }
}
