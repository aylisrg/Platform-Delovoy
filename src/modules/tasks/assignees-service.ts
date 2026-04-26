import type { Role, TaskAssignee, TaskAssigneeRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  TaskAccessError,
  TaskNotFoundError,
  TaskValidationError,
  canAccessTask,
  isAdmin,
} from "./access";
import { dispatchTaskEvent } from "./notify";

export async function addAssignee(
  publicId: string,
  data: { userId: string; role: TaskAssigneeRole; demoteCurrent?: boolean },
  ctx: { actorUserId: string; actorRole: Role }
): Promise<TaskAssignee> {
  const task = await prisma.task.findUnique({ where: { publicId } });
  if (!task || task.deletedAt) throw new TaskNotFoundError();

  // ADMIN+ or current RESPONSIBLE
  const allowed =
    isAdmin(ctx.actorRole) ||
    (await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "manage"));
  if (!allowed) throw new TaskAccessError();

  if (data.role === "RESPONSIBLE") {
    const current = await prisma.taskAssignee.findFirst({
      where: { taskId: task.id, role: "RESPONSIBLE" },
    });
    if (current && current.userId !== data.userId) {
      if (data.demoteCurrent) {
        await prisma.taskAssignee.update({
          where: { id: current.id },
          data: { role: "COLLABORATOR" },
        });
      } else {
        throw new TaskValidationError(
          "RESPONSIBLE_CONFLICT",
          "Уже назначен ответственный. Передайте флаг demoteCurrent=true для замены"
        );
      }
    }
  }

  const existing = await prisma.taskAssignee.findUnique({
    where: { taskId_userId: { taskId: task.id, userId: data.userId } },
  });
  let assignee: TaskAssignee;
  if (existing) {
    if (existing.role === data.role) return existing;
    assignee = await prisma.taskAssignee.update({
      where: { id: existing.id },
      data: { role: data.role },
    });
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        actorUserId: ctx.actorUserId,
        kind: "ASSIGNEE_ROLE_CHANGED",
        metadata: { userId: data.userId, from: existing.role, to: data.role },
      },
    });
  } else {
    assignee = await prisma.taskAssignee.create({
      data: {
        taskId: task.id,
        userId: data.userId,
        role: data.role,
        assignedById: ctx.actorUserId,
      },
    });
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        actorUserId: ctx.actorUserId,
        kind: "ASSIGNEE_ADDED",
        metadata: { userId: data.userId, role: data.role },
      },
    });
  }
  await prisma.auditLog.create({
    data: {
      userId: ctx.actorUserId,
      action: "task.assignee.add",
      entity: "Task",
      entityId: task.id,
      metadata: { userId: data.userId, role: data.role },
    },
  });

  void dispatchTaskEvent({
    taskId: task.id,
    eventType: "task.assignee_added",
    actorUserId: ctx.actorUserId,
    payload: {
      title: `Вас назначили на задачу ${task.publicId}`,
      body: task.title,
      actions: [
        {
          label: "Открыть",
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/tasks/${task.publicId}`,
        },
      ],
      metadata: { entityType: "Task", entityId: task.id },
    },
    recipientUserIds: [data.userId],
  });

  return assignee;
}

export async function removeAssignee(
  publicId: string,
  userId: string,
  ctx: { actorUserId: string; actorRole: Role }
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { publicId } });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const allowed =
    isAdmin(ctx.actorRole) ||
    (await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "manage"));
  if (!allowed) throw new TaskAccessError();

  const existing = await prisma.taskAssignee.findUnique({
    where: { taskId_userId: { taskId: task.id, userId } },
  });
  if (!existing) return;
  await prisma.taskAssignee.delete({ where: { id: existing.id } });
  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorUserId: ctx.actorUserId,
      kind: "ASSIGNEE_REMOVED",
      metadata: { userId, role: existing.role },
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: ctx.actorUserId,
      action: "task.assignee.remove",
      entity: "Task",
      entityId: task.id,
      metadata: { userId, role: existing.role },
    },
  });
}
