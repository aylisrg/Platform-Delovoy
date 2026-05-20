import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SEGMENT_RESOLVERS, SEGMENT_LABELS } from "@/modules/notifications/cohorts/segments";
import { SEGMENT_KEYS } from "@/modules/notifications/cohorts/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "notifications");
    if (denied) return denied;

    if (session!.user.role !== "SUPERADMIN") {
      return apiError("FORBIDDEN", "Только суперадмин может просматривать превью рассылок", 403);
    }

    const segmentKey = request.nextUrl.searchParams.get("segment");
    if (!segmentKey) return apiValidationError("segment query param required");
    if (!(SEGMENT_KEYS as readonly string[]).includes(segmentKey)) {
      return apiError("INVALID_SEGMENT", "Unknown segment key", 400);
    }

    const key = segmentKey as (typeof SEGMENT_KEYS)[number];
    const userIds = await SEGMENT_RESOLVERS[key](prisma);

    const sample = await prisma.user.findMany({
      where: { id: { in: userIds.slice(0, 10) } },
      select: { id: true, name: true, email: true, phone: true },
    });

    return apiResponse({
      segmentKey: key,
      label: SEGMENT_LABELS[key],
      total: userIds.length,
      sample,
    });
  } catch (err) {
    return apiServerError(err instanceof Error ? err.message : undefined);
  }
}
