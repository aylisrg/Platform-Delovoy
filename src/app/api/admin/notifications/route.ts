import { apiResponse, apiUnauthorized, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserAdminSections } from "@/lib/permissions";

/**
 * GET /api/admin/notifications — recent admin notification history.
 * Returns the last 50 admin notifications filtered by the user's sections.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "MANAGER") {
      return apiUnauthorized();
    }

    const sections = await getUserAdminSections(session.user.id);

    // Fetch recent admin notifications (userId is null for admin notifications)
    const notifications = await prisma.notificationLog.findMany({
      where: {
        userId: null, // admin notifications have no userId
        ...(role !== "SUPERADMIN" && {
          moduleSlug: { in: sections },
        }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        eventType: true,
        moduleSlug: true,
        entityId: true,
        message: true,
        status: true,
        createdAt: true,
      },
    });

    return apiResponse(notifications);
  } catch (error) {
    console.error("[Admin Notifications] Error:", error);
    return apiServerError();
  }
}
