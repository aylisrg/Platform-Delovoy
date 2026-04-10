import { apiResponse, apiUnauthorized, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserAdminSections } from "@/lib/permissions";

/**
 * GET /api/admin/badge-counts — returns unread/pending counts per module.
 * Used by the sidebar for red badge indicators.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const sections = await getUserAdminSections(session.user.id);
    const counts: Record<string, number> = {};

    const queries: Promise<void>[] = [];

    if (sections.includes("gazebos")) {
      queries.push(
        prisma.booking
          .count({ where: { moduleSlug: "gazebos", status: "PENDING" } })
          .then((n) => { counts.gazebos = n; })
      );
    }

    if (sections.includes("ps-park")) {
      queries.push(
        prisma.booking
          .count({ where: { moduleSlug: "ps-park", status: "PENDING" } })
          .then((n) => { counts["ps-park"] = n; })
      );
    }

    if (sections.includes("cafe")) {
      queries.push(
        prisma.order
          .count({ where: { moduleSlug: "cafe", status: "NEW" } })
          .then((n) => { counts.cafe = n; })
      );
    }

    if (sections.includes("rental")) {
      queries.push(
        prisma.rentalInquiry
          .count({ where: { isRead: false, status: { in: ["NEW", "IN_PROGRESS"] } } })
          .then((n) => { counts.rental = n; })
      );
    }

    if (sections.includes("clients")) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      queries.push(
        prisma.user
          .count({ where: { role: "USER", createdAt: { gte: oneDayAgo } } })
          .then((n) => { counts.clients = n; })
      );
    }

    await Promise.all(queries);

    return apiResponse(counts);
  } catch (error) {
    console.error("[Badge Counts] Error:", error);
    return apiServerError();
  }
}
