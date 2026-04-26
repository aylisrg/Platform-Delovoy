import { Prisma, type Role, type Task } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasModuleAccess } from "@/lib/permissions";
import { generatePublicId } from "./public-id";
import {
  resolveDefaultResponsible,
  resolveTargetBoardAndColumn,
} from "./routing";
import {
  TaskAccessError,
  TaskNotFoundError,
  TaskValidationError,
  canAccessTask,
  isAdmin,
} from "./access";
import type {
  CreateTaskInput,
  TaskWithRelations,
  UpdateTaskInput,
} from "./types";
import type { TaskListQuery } from "./validation";
import { dispatchTaskEvent } from "./notify";

const TASK_INCLUDE = {
  board: true,
  column: true,
  category: true,
  assignees: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
  _count: { select: { comments: true, events: true } },
} satisfies Prisma.TaskInclude;

export async function createTask(input: {
  data: CreateTaskInput;
  actorUserId: string | null;
  actorRole: Role | null;
}): Promise<TaskWithRelations> {
  const { data, actorUserId } = input;
  if (!data.title || data.title.trim().length === 0) {
    throw new TaskValidationError("VALIDATION_ERROR", "title required");
  }

  const categoryId = data.categoryId ?? null;
  const { boardId, columnId } = await resolveTargetBoardAndColumn(
    data.boardId,
    data.columnId,
    categoryId
  );
  const { userId: defaultResponsibleId, priorityHint } =
    await resolveDefaultResponsible(categoryId);

  const dueAt = coerceDate(data.dueAt);

  // Generate publicId with retry on collision
  let task: Task | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const publicId = generatePublicId();
    try {
      task = await prisma.task.create({
        data: {
          publicId,
          boardId,
          columnId,
          categoryId,
          title: data.title.trim().slice(0, 200),
          description: data.description?.trim().slice(0, 20000) ?? null,
          priority: data.priority ?? priorityHint ?? "NONE",
          dueAt,
          labels: data.labels ?? [],
          source: data.source ?? "MANUAL",
          reporterUserId: data.reporterUserId ?? null,
          externalContact: data.externalContact
            ? (data.externalContact as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          officeId: data.officeId ?? null,
        },
      });
      break;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        continue; // publicId collision — retry
      }
      throw err;
    }
  }
  if (!task) throw new Error("publicId generation exhausted");

  // Assignees
  const responsibleId = data.responsibleUserId ?? defaultResponsibleId ?? null;
  const assigneesData: Prisma.TaskAssigneeCreateManyInput[] = [];
  if (responsibleId) {
    assigneesData.push({
      taskId: task.id,
      userId: responsibleId,
      role: "RESPONSIBLE",
      assignedById: actorUserId,
    });
  }
  for (const userId of data.collaboratorUserIds ?? []) {
    if (userId === responsibleId) continue;
    assigneesData.push({
      taskId: task.id,
      userId,
      role: "COLLABORATOR",
      assignedById: actorUserId,
    });
  }
  for (const userId of data.watcherUserIds ?? []) {
    if (userId === responsibleId) continue;
    if ((data.collaboratorUserIds ?? []).includes(userId)) continue;
    assigneesData.push({
      taskId: task.id,
      userId,
      role: "WATCHER",
      assignedById: actorUserId,
    });
  }
  if (assigneesData.length) {
    await prisma.taskAssignee.createMany({ data: assigneesData, skipDuplicates: true });
  }

  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorUserId,
      kind: "CREATED",
      metadata: { source: task.source },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorUserId ?? "system",
      action: "task.create",
      entity: "Task",
      entityId: task.id,
      metadata: {
        publicId: task.publicId,
        source: task.source,
        boardId: task.boardId,
        categoryId: task.categoryId,
      },
    },
  });

  // Fire-and-forget notifications
  void dispatchTaskEvent({
    taskId: task.id,
    eventType: "task.created",
    actorUserId,
    payload: {
      title: `Новая задача ${task.publicId}`,
      body: task.title,
      actions: [{ label: "Открыть", url: taskUrl(task.publicId) }],
      metadata: { entityType: "Task", entityId: task.id, publicId: task.publicId },
    },
  });

  return getTaskByPublicId(task.publicId, { actorUserId, actorRole: input.actorRole });
}

export async function getTaskByPublicId(
  publicId: string,
  ctx: { actorUserId: string | null; actorRole: Role | null }
): Promise<TaskWithRelations> {
  const task = await prisma.task.findUnique({
    where: { publicId },
    include: TASK_INCLUDE,
  });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  if (ctx.actorUserId && ctx.actorRole) {
    const canRead = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "read");
    if (!canRead) throw new TaskAccessError();
  }
  return task as TaskWithRelations;
}

export async function listTasks(
  ctx: { actorUserId: string; actorRole: Role },
  q: TaskListQuery
): Promise<{ items: TaskWithRelations[]; total: number; page: number; perPage: number }> {
  const where: Prisma.TaskWhereInput = { deletedAt: null };

  if (q.boardId) where.boardId = q.boardId;
  if (q.columnId) where.columnId = q.columnId;
  if (q.categoryId) where.categoryId = q.categoryId;
  if (q.source) where.source = q.source;
  if (q.priority?.length) where.priority = { in: q.priority };
  if (q.labels?.length) where.labels = { hasSome: q.labels };
  if (q.q) {
    where.OR = [
      { title: { contains: q.q, mode: "insensitive" } },
      { description: { contains: q.q, mode: "insensitive" } },
      { publicId: { contains: q.q.toUpperCase() } },
    ];
  }
  if (q.dueFrom) where.dueAt = { ...(where.dueAt as object), gte: q.dueFrom };
  if (q.dueTo) where.dueAt = { ...(where.dueAt as object), lte: q.dueTo };
  if (q.overdue) {
    where.dueAt = { lt: new Date() };
    where.closedAt = null;
  }

  // RBAC scope:
  // - SUPERADMIN/ADMIN: all
  // - MANAGER with hasModuleAccess("tasks"): all in his boards (V1 == all)
  // - other: only tasks where user is assignee or reporter
  if (!isAdmin(ctx.actorRole)) {
    const isManagerWithAccess =
      ctx.actorRole === "MANAGER" &&
      (await hasModuleAccess(ctx.actorUserId, "tasks"));
    if (!isManagerWithAccess) {
      const orClauses: Prisma.TaskWhereInput[] = [
        { reporterUserId: ctx.actorUserId },
        { assignees: { some: { userId: ctx.actorUserId } } },
      ];
      where.AND = [
        { OR: orClauses },
        ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
      ];
    }
  }

  if (q.assigneeId) {
    where.assignees = {
      some: q.assigneeRole
        ? { userId: q.assigneeId, role: q.assigneeRole }
        : { userId: q.assigneeId },
    };
  }

  const skip = (q.page - 1) * q.limit;
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [{ columnId: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      skip,
      take: q.limit,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    items: items as TaskWithRelations[],
    total,
    page: q.page,
    perPage: q.limit,
  };
}

export async function updateTask(
  publicId: string,
  data: UpdateTaskInput,
  ctx: { actorUserId: string; actorRole: Role }
): Promise<TaskWithRelations> {
  const task = await prisma.task.findUnique({ where: { publicId } });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const can = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "write");
  if (!can) throw new TaskAccessError();

  const updateData: Prisma.TaskUpdateInput = {};
  const events: { kind: import("@prisma/client").TaskEventKind; metadata: Prisma.InputJsonValue }[] = [];

  if (data.title !== undefined && data.title !== task.title) {
    updateData.title = data.title.trim().slice(0, 200);
    events.push({ kind: "TITLE_CHANGED", metadata: { from: task.title, to: data.title } });
  }
  if (data.description !== undefined && data.description !== task.description) {
    updateData.description = data.description ? data.description.trim().slice(0, 20000) : null;
    events.push({ kind: "DESCRIPTION_CHANGED", metadata: {} });
  }
  if (data.categoryId !== undefined && data.categoryId !== task.categoryId) {
    updateData.category = data.categoryId
      ? { connect: { id: data.categoryId } }
      : { disconnect: true };
    events.push({
      kind: "CATEGORY_CHANGED",
      metadata: { from: task.categoryId, to: data.categoryId },
    });
  }
  if (data.priority !== undefined && data.priority !== task.priority) {
    updateData.priority = data.priority;
    events.push({
      kind: "PRIORITY_CHANGED",
      metadata: { from: task.priority, to: data.priority },
    });
  }
  if (data.dueAt !== undefined) {
    const newDate = coerceDate(data.dueAt);
    const old = task.dueAt?.toISOString() ?? null;
    const next = newDate?.toISOString() ?? null;
    if (old !== next) {
      updateData.dueAt = newDate;
      events.push({
        kind: "DUE_CHANGED",
        metadata: { from: old, to: next },
      });
    }
  }
  if (data.labels !== undefined) {
    const newLabels = data.labels;
    updateData.labels = newLabels;
    const added = newLabels.filter((l) => !task.labels.includes(l));
    const removed = task.labels.filter((l) => !newLabels.includes(l));
    for (const l of added) events.push({ kind: "LABEL_ADDED", metadata: { label: l } });
    for (const l of removed) events.push({ kind: "LABEL_REMOVED", metadata: { label: l } });
  }

  if (Object.keys(updateData).length === 0) {
    return getTaskByPublicId(publicId, ctx);
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: updateData,
  });

  if (events.length) {
    await prisma.taskEvent.createMany({
      data: events.map((e) => ({
        taskId: task.id,
        actorUserId: ctx.actorUserId,
        kind: e.kind,
        metadata: e.metadata,
      })),
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: ctx.actorUserId,
      action: "task.update",
      entity: "Task",
      entityId: task.id,
      metadata: { publicId: task.publicId, fields: Object.keys(updateData) },
    },
  });

  void dispatchTaskEvent({
    taskId: updated.id,
    eventType: "task.updated",
    actorUserId: ctx.actorUserId,
    payload: {
      title: `Задача ${updated.publicId} обновлена`,
      body: events.map((e) => e.kind).join(", "),
      actions: [{ label: "Открыть", url: taskUrl(updated.publicId) }],
      metadata: { entityType: "Task", entityId: updated.id },
    },
  });

  return getTaskByPublicId(publicId, ctx);
}

export async function moveTaskToColumn(
  publicId: string,
  payload: { columnId: string; sortOrder?: number },
  ctx: { actorUserId: string; actorRole: Role }
): Promise<TaskWithRelations> {
  const task = await prisma.task.findUnique({
    where: { publicId },
    include: { column: true },
  });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const can = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "write");
  if (!can) throw new TaskAccessError();

  const targetColumn = await prisma.taskColumn.findUnique({
    where: { id: payload.columnId },
  });
  if (!targetColumn || targetColumn.boardId !== task.boardId) {
    throw new TaskValidationError("INVALID_COLUMN", "Column not in same board");
  }

  // WIP-limit warning (soft) — don't block, just log
  if (targetColumn.wipLimit) {
    const count = await prisma.task.count({
      where: { columnId: targetColumn.id, deletedAt: null },
    });
    if (count >= targetColumn.wipLimit) {
      // soft: continue but emit a system event
      await prisma.systemEvent.create({
        data: {
          level: "WARNING",
          source: "tasks",
          message: `WIP-limit exceeded in column ${targetColumn.name}`,
          metadata: { columnId: targetColumn.id, count, limit: targetColumn.wipLimit },
        },
      });
    }
  }

  const sortOrder = payload.sortOrder ?? Date.now();
  const closedAt =
    targetColumn.isTerminal && !task.column.isTerminal ? new Date() : task.closedAt;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { columnId: targetColumn.id, sortOrder, closedAt },
  });

  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorUserId: ctx.actorUserId,
      kind: "COLUMN_CHANGED",
      metadata: {
        from: task.columnId,
        to: targetColumn.id,
        terminal: targetColumn.isTerminal,
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: ctx.actorUserId,
      action: "task.move",
      entity: "Task",
      entityId: task.id,
      metadata: {
        publicId: task.publicId,
        from: task.columnId,
        to: targetColumn.id,
      },
    },
  });

  void dispatchTaskEvent({
    taskId: updated.id,
    eventType: targetColumn.isTerminal ? "task.closed" : "task.column_changed",
    actorUserId: ctx.actorUserId,
    payload: {
      title: `Задача ${updated.publicId}: ${targetColumn.name}`,
      body: updated.title,
      actions: [{ label: "Открыть", url: taskUrl(updated.publicId) }],
      metadata: { entityType: "Task", entityId: updated.id },
    },
    notifyReporter: targetColumn.isTerminal,
  });

  return getTaskByPublicId(publicId, ctx);
}

export async function reorderTaskInColumn(
  publicId: string,
  sortOrder: number,
  ctx: { actorUserId: string; actorRole: Role }
): Promise<TaskWithRelations> {
  const task = await prisma.task.findUnique({ where: { publicId } });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const can = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "write");
  if (!can) throw new TaskAccessError();

  await prisma.task.update({
    where: { id: task.id },
    data: { sortOrder },
  });
  await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      actorUserId: ctx.actorUserId,
      kind: "COLUMN_REORDERED",
      metadata: { sortOrder },
    },
  });

  return getTaskByPublicId(publicId, ctx);
}

export async function softDeleteTask(
  publicId: string,
  ctx: { actorUserId: string; actorRole: Role }
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { publicId } });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  if (!isAdmin(ctx.actorRole)) throw new TaskAccessError();

  await prisma.task.update({
    where: { id: task.id },
    data: { deletedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      userId: ctx.actorUserId,
      action: "task.delete",
      entity: "Task",
      entityId: task.id,
      metadata: { publicId: task.publicId },
    },
  });
}

function coerceDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function taskUrl(publicId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://delovoy-park.ru";
  return `${base}/admin/tasks/${publicId}`;
}

export type { TaskWithRelations };
