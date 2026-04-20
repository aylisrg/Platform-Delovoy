import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { historyFilterSchema } from "@/modules/notifications/validation";

/**
 * GET /api/notifications/history
 * Get notification history for current user.
 * Admins can pass ?userId=xxx to view other users' history.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = historyFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    // Admins can view other users' logs
    let userId = session.user.id;
    const requestedUserId = request.nextUrl.searchParams.get("userId");
    if (
      requestedUserId &&
      (session.user.role === "SUPERADMIN" || session.user.role === "ADMIN" || session.user.role === "MANAGER")
    ) {
      userId = requestedUserId;
    }

    const { page, limit, moduleSlug, eventType } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(moduleSlug ? { moduleSlug } : {}),
      ...(eventType ? { eventType } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          channel: true,
          eventType: true,
          moduleSlug: true,
          status: true,
          createdAt: true,
          sentAt: true,
        },
      }),
      prisma.notificationLog.count({ where }),
    ]);

    return apiResponse(logs, { page, perPage: limit, total });
  } catch {
    return apiServerError();
  }
}
