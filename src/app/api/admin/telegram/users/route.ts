import { apiResponse, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/telegram/users — list all users who have a Telegram account linked.
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const users = await prisma.user.findMany({
      where: {
        telegramId: { not: null },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        telegramId: true,
        role: true,
        image: true,
        createdAt: true,
        _count: {
          select: {
            bookings: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return apiResponse(users);
  } catch (error) {
    console.error("[Admin Telegram] Users error:", error);
    return apiServerError();
  }
}
