import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { rateLimitCustom } from "@/modules/tasks/rate-limit";
import { dispatchTaskEvent } from "@/modules/tasks/notify";

const trackCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

type Params = { params: Promise<{ publicId: string }> };

/**
 * Public-track comment endpoint (AC-070).
 * Authenticated reporter (matched by externalContact.email or reporterUserId)
 * may add a `visibleToReporter=true` comment.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const limited = await rateLimitCustom(
      session.user.id,
      "tasks-track-comment",
      10,
      60
    );
    if (limited) return limited;

    const { publicId } = await params;
    if (!/^TASK-[2-9A-HJ-NP-Z]{5}$/.test(publicId)) {
      return apiValidationError("invalid publicId");
    }
    const body = await request.json().catch(() => null);
    const parsed = trackCommentSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }

    const task = await prisma.task.findUnique({
      where: { publicId },
      select: {
        id: true,
        deletedAt: true,
        reporterUserId: true,
        externalContact: true,
        title: true,
      },
    });
    if (!task || task.deletedAt) return apiNotFound();

    // Authorization: reporter is either the same userId, or session email matches externalContact.email
    const userEmail = session.user.email?.toLowerCase() ?? null;
    const reporterEmail =
      (task.externalContact as { email?: string } | null)?.email?.toLowerCase() ??
      null;
    const ok =
      task.reporterUserId === session.user.id ||
      (Boolean(userEmail) && userEmail === reporterEmail);
    if (!ok) return apiUnauthorized();

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorUserId: session.user.id,
        body: parsed.data.body,
        visibleToReporter: true,
        source: "PUBLIC_TRACK",
      },
    });
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        actorUserId: session.user.id,
        kind: "COMMENT_ADDED",
        metadata: { commentId: comment.id, source: "PUBLIC_TRACK" },
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "task.track.comment",
        entity: "TaskComment",
        entityId: comment.id,
        metadata: { taskId: task.id, publicId },
      },
    });

    void dispatchTaskEvent({
      taskId: task.id,
      eventType: "task.commented_visible_to_reporter",
      actorUserId: session.user.id,
      payload: {
        title: `Уточнение по ${publicId}`,
        body: parsed.data.body.slice(0, 240),
        actions: [
          {
            label: "Открыть",
            url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/tasks/${publicId}`,
          },
        ],
        metadata: { entityType: "Task", entityId: task.id },
      },
      notifyReporter: false,
    });

    return apiResponse(
      { id: comment.id, body: comment.body, createdAt: comment.createdAt },
      undefined,
      201
    );
  } catch {
    return apiServerError();
  }
}
