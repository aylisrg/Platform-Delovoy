import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiNotFound,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { addComment, NotFoundError } from "@/modules/feedback/service";
import { createCommentSchema } from "@/modules/feedback/validation";
import { prisma } from "@/lib/db";
import { recordDashboardEvent } from "@/modules/analytics/dashboard-events";

/**
 * POST /api/feedback/[id]/comments — owner or SUPERADMIN may reply.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { id } = await params;
    if (session.user.role !== "SUPERADMIN") {
      const own = await prisma.feedbackItem.findFirst({
        where: { id, userId: session.user.id },
        select: { id: true },
      });
      if (!own) return apiNotFound("Обращение не найдено");
    }
    const body = await request.json();
    const parsed = createCommentSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(
        parsed.error.issues[0]?.message || "Некорректные данные",
      );
    }

    const comment = await addComment(id, session.user.id, parsed.data.text);
    await recordDashboardEvent(session.user.id, "feedback_reply_succeeded");
    return apiResponse(comment, undefined, 201);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return apiNotFound(error.message);
    }
    return apiServerError();
  }
}
