import { Prisma, type Role, type TaskComment } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  TaskAccessError,
  TaskNotFoundError,
  canAccessTask,
} from "./access";
import { resolveMentions } from "./mentions";
import { dispatchTaskEvent } from "./notify";

export async function listComments(
  publicId: string,
  ctx: { actorUserId: string; actorRole: Role }
): Promise<TaskComment[]> {
  const task = await prisma.task.findUnique({
    where: { publicId },
    select: { id: true, reporterUserId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const canRead = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "read");
  if (!canRead) throw new TaskAccessError();

  // Reporter (non-admin, non-assignee) sees only visibleToReporter=true
  const isReporterOnly =
    task.reporterUserId === ctx.actorUserId && !["SUPERADMIN", "ADMIN"].includes(ctx.actorRole);

  return prisma.taskComment.findMany({
    where: {
      taskId: task.id,
      ...(isReporterOnly ? { visibleToReporter: true } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createComment(
  publicId: string,
  data: {
    body: string;
    visibleToReporter?: boolean;
    attachments?: Array<{ url: string; filename: string; size?: number; mimeType?: string }>;
    inReplyToCommentId?: string;
  },
  ctx: { actorUserId: string; actorRole: Role }
): Promise<TaskComment> {
  const task = await prisma.task.findUnique({ where: { publicId } });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const canWrite = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "write");
  if (!canWrite) throw new TaskAccessError();

  const comment = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorUserId: ctx.actorUserId,
      body: data.body,
      visibleToReporter: data.visibleToReporter ?? false,
      attachments: (data.attachments as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
      inReplyToCommentId: data.inReplyToCommentId,
      source: "MANUAL",
    },
  });
  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorUserId: ctx.actorUserId,
      kind: "COMMENT_ADDED",
      metadata: { commentId: comment.id, visibleToReporter: comment.visibleToReporter },
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: ctx.actorUserId,
      action: "task.comment.create",
      entity: "TaskComment",
      entityId: comment.id,
      metadata: { taskId: task.id, publicId: task.publicId },
    },
  });

  // Resolve mentions
  const tokens = resolveMentions(
    data.body,
    await prisma.user.findMany({
      where: { id: { not: ctx.actorUserId } },
      select: { id: true, name: true, email: true },
    })
  );
  if (tokens.length) {
    void dispatchTaskEvent({
      taskId: task.id,
      eventType: "task.mention",
      actorUserId: ctx.actorUserId,
      payload: {
        title: `Вас упомянули в ${task.publicId}`,
        body: data.body.slice(0, 240),
        actions: [
          {
            label: "Открыть",
            url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/tasks/${task.publicId}`,
          },
        ],
        metadata: { entityType: "Task", entityId: task.id },
      },
      recipientUserIds: tokens.map((u) => u.id),
    });
  }

  void dispatchTaskEvent({
    taskId: task.id,
    eventType: data.visibleToReporter
      ? "task.commented_visible_to_reporter"
      : "task.commented",
    actorUserId: ctx.actorUserId,
    payload: {
      title: `Новый комментарий ${task.publicId}`,
      body: data.body.slice(0, 240),
      actions: [
        {
          label: "Открыть",
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/tasks/${task.publicId}`,
        },
      ],
      metadata: { entityType: "Task", entityId: task.id },
    },
    notifyReporter: data.visibleToReporter,
  });

  return comment;
}
