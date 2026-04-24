// Task service — the one place where Task state mutations live.
// Route handlers and background workers must call these functions rather than
// hit Prisma directly, so audit-log and event-timeline entries stay consistent.

import { prisma } from "@/lib/db";
import { log, logAudit } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { generatePublicId } from "./public-id";
import { resolveAssignee } from "./routing";
import { resolveMentions } from "./mentions";
import { notifyAssignee, taskLink, notifyReporterConfirmation } from "./notifications";
import type {
  CreateTaskInput,
  CreateCommentInput,
  ListTasksInput,
} from "./validation";

const PUBLIC_ID_MAX_RETRIES = 5;

/**
 * Validation produces `Date | string | null | undefined` on date fields because
 * it uses z.coerce.date(). Prisma strictly wants Date or null. Narrow here.
 * The raw input type is `unknown` since coerce accepts anything — we treat
 * only strings and Dates as valid input.
 */
function toDateOrNull(v: unknown): Date | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return null;
}

const TASK_WITH_RELATIONS = {
  category: { select: { id: true, slug: true, name: true } },
  reporter: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  externalTenant: { select: { id: true, companyName: true } },
  externalOffice: { select: { id: true, number: true, building: true, floor: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

/**
 * Create a task. Handles:
 *  - publicId generation with retry on (astronomically rare) collision
 *  - auto-assignment via routing (when assigneeUserId not explicitly set)
 *  - CREATED + ASSIGNED events
 *  - audit log
 *  - assignee notification
 *  - reporter confirmation email for ISSUE tasks
 */
export async function createTask(
  input: CreateTaskInput,
  actor: { id: string | null; source: "user" | "system" } = { id: null, source: "system" }
) {
  const wantedAssignee =
    input.assigneeUserId !== undefined && input.assigneeUserId !== null
      ? input.assigneeUserId
      : await resolveAssignee(input.categoryId ?? null);

  // Generate public id with retry for uniqueness.
  let created: Awaited<ReturnType<typeof prisma.task.create>> | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < PUBLIC_ID_MAX_RETRIES; attempt++) {
    const publicId = generatePublicId();
    try {
      created = await prisma.task.create({
        data: {
          publicId,
          type: input.type ?? "INTERNAL",
          source: input.source ?? "MANUAL",
          moduleContext: input.moduleContext ?? null,
          title: input.title,
          description: input.description ?? null,
          status: input.status ?? "TODO",
          priority: input.priority ?? "MEDIUM",
          categoryId: input.categoryId ?? null,
          labels: input.labels ?? [],
          reporterUserId: input.reporterUserId ?? null,
          assigneeUserId: wantedAssignee,
          externalTenantId: input.externalTenantId ?? null,
          externalOfficeId: input.externalOfficeId ?? null,
          externalContact: (input.externalContact as Prisma.InputJsonValue | undefined) ?? undefined,
          dueDate: toDateOrNull(input.dueDate),
          remindAt: toDateOrNull(input.remindAt),
          emailThreadId: input.emailThreadId ?? null,
          metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
        },
        include: TASK_WITH_RELATIONS,
      });
      break;
    } catch (err) {
      lastErr = err;
      // Only retry on publicId unique violation. Prisma error code P2002.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  if (!created) {
    throw lastErr instanceof Error ? lastErr : new Error("Не удалось создать задачу");
  }

  await prisma.taskEvent.create({
    data: {
      taskId: created.id,
      kind: "CREATED",
      actorUserId: actor.source === "user" ? actor.id : null,
      metadata: { source: input.source ?? "MANUAL" },
    },
  });

  if (wantedAssignee) {
    await prisma.taskEvent.create({
      data: {
        taskId: created.id,
        kind: "ASSIGNED",
        actorUserId: actor.source === "user" ? actor.id : null,
        metadata: { toUserId: wantedAssignee },
      },
    });
    await notifyAssignee(
      wantedAssignee,
      { publicId: created.publicId, title: created.title, link: taskLink(created.publicId) },
      "assigned"
    ).catch(() => {});
  }

  if (actor.source === "user" && actor.id) {
    await logAudit(actor.id, "task.create", "Task", created.id, {
      type: created.type,
      source: created.source,
      publicId: created.publicId,
    });
  }

  if (created.type === "ISSUE") {
    const contact = created.externalContact as { email?: string } | null;
    if (contact?.email) {
      await notifyReporterConfirmation(
        contact.email,
        created.publicId,
        created.title
      ).catch(() => {});
    }
  }

  return created;
}

export type TaskVisibilityScope =
  | { role: "SUPERADMIN" | "ADMIN" }
  | { role: "MANAGER"; userId: string; categoryIds: string[] }
  | { role: "USER" };

/**
 * List tasks with pagination + RBAC scope.
 * - SUPERADMIN/ADMIN: everything
 * - MANAGER: assignee=me OR reporter=me OR category in their defaultAssignee list
 * - USER: empty (caller should 403 earlier)
 */
export async function listTasks(
  input: ListTasksInput,
  scope: TaskVisibilityScope
) {
  if (scope.role === "USER") {
    return { items: [], total: 0 };
  }

  const where: Prisma.TaskWhereInput = {};
  if (input.type) where.type = input.type;
  if (input.status) where.status = input.status;
  if (input.priority) where.priority = input.priority;
  if (input.categoryId) where.categoryId = input.categoryId;
  if (input.assigneeUserId) where.assigneeUserId = input.assigneeUserId;
  if (input.moduleContext) where.moduleContext = input.moduleContext;
  if (input.q) {
    where.OR = [
      { title: { contains: input.q, mode: "insensitive" } },
      { description: { contains: input.q, mode: "insensitive" } },
      { publicId: { contains: input.q.toUpperCase(), mode: "insensitive" } },
    ];
  }

  if (scope.role === "MANAGER") {
    const visibility: Prisma.TaskWhereInput["OR"] = [
      { assigneeUserId: scope.userId },
      { reporterUserId: scope.userId },
    ];
    if (scope.categoryIds.length > 0) {
      visibility.push({ categoryId: { in: scope.categoryIds }, type: "ISSUE" });
    }
    where.AND = [
      ...(where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : []),
      { OR: visibility },
    ];
  }

  const [total, items] = await prisma.$transaction([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: TASK_WITH_RELATIONS,
    }),
  ]);

  return { items, total };
}

export async function getTaskByPublicId(publicId: string) {
  return prisma.task.findUnique({
    where: { publicId },
    include: {
      ...TASK_WITH_RELATIONS,
      events: { orderBy: { createdAt: "asc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

export async function updateStatus(
  taskId: string,
  status:
    | "BACKLOG"
    | "TODO"
    | "IN_PROGRESS"
    | "IN_REVIEW"
    | "BLOCKED"
    | "DONE"
    | "CANCELLED",
  actor: { id: string }
) {
  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, publicId: true, status: true, assigneeUserId: true, title: true },
  });
  if (!before) return null;
  if (before.status === status) return before;

  const resolvedAt = status === "DONE" ? new Date() : null;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { status, resolvedAt },
    include: TASK_WITH_RELATIONS,
  });

  await prisma.taskEvent.create({
    data: {
      taskId,
      kind: status === "DONE" ? "RESOLVED" : "STATUS_CHANGED",
      actorUserId: actor.id,
      metadata: { from: before.status, to: status },
    },
  });

  await logAudit(actor.id, "task.status", "Task", taskId, {
    from: before.status,
    to: status,
  });

  return updated;
}

export async function updateAssignee(
  taskId: string,
  newAssigneeUserId: string | null,
  actor: { id: string }
) {
  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, publicId: true, assigneeUserId: true, title: true },
  });
  if (!before) return null;
  if (before.assigneeUserId === newAssigneeUserId) return before;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { assigneeUserId: newAssigneeUserId },
    include: TASK_WITH_RELATIONS,
  });

  await prisma.taskEvent.create({
    data: {
      taskId,
      kind: "ASSIGNED",
      actorUserId: actor.id,
      metadata: { from: before.assigneeUserId, to: newAssigneeUserId },
    },
  });

  await logAudit(actor.id, "task.assign", "Task", taskId, {
    from: before.assigneeUserId,
    to: newAssigneeUserId,
  });

  if (newAssigneeUserId) {
    await notifyAssignee(
      newAssigneeUserId,
      { publicId: before.publicId, title: before.title, link: taskLink(before.publicId) },
      "assigned"
    ).catch(() => {});
  }

  return updated;
}

export async function addComment(
  taskId: string,
  input: CreateCommentInput,
  author: { id: string | null; name?: string | null; externalContact?: Record<string, unknown> },
  options: { emailMessageId?: string | null } = {}
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, publicId: true, title: true, assigneeUserId: true },
  });
  if (!task) return null;

  // Idempotency for email-sourced comments.
  if (options.emailMessageId) {
    const existing = await prisma.taskComment.findUnique({
      where: { emailMessageId: options.emailMessageId },
      select: { id: true },
    });
    if (existing) return existing;
  }

  const comment = await prisma.taskComment.create({
    data: {
      taskId,
      authorUserId: author.id,
      authorExternal: author.id
        ? undefined
        : (author.externalContact as Prisma.InputJsonValue | undefined),
      body: input.body,
      source: input.source ?? "WEB",
      emailMessageId: options.emailMessageId ?? null,
    },
  });

  await prisma.taskEvent.create({
    data: {
      taskId,
      kind: "COMMENTED",
      actorUserId: author.id,
      metadata: { commentId: comment.id, source: input.source ?? "WEB" },
    },
  });

  if (author.id) {
    await logAudit(author.id, "task.comment", "Task", taskId, {
      commentId: comment.id,
    });
  }

  // @mentions → notify
  try {
    const allUsers = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
      where: { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } },
    });
    const mentioned = resolveMentions(input.body, allUsers);
    for (const user of mentioned) {
      if (user.id === author.id) continue;
      await notifyAssignee(
        user.id,
        {
          publicId: task.publicId,
          title: task.title,
          link: taskLink(task.publicId),
          actorName: author.name ?? null,
        },
        "mentioned"
      ).catch(() => {});
    }
  } catch (err) {
    await log.warn(
      "tasks.service",
      `Mention resolution failed for task ${task.publicId}: ${String(err)}`
    );
  }

  // Notify assignee about new comment (unless they wrote it themselves)
  if (task.assigneeUserId && task.assigneeUserId !== author.id) {
    await notifyAssignee(
      task.assigneeUserId,
      {
        publicId: task.publicId,
        title: task.title,
        link: taskLink(task.publicId),
        actorName: author.name ?? null,
      },
      "commented"
    ).catch(() => {});
  }

  return comment;
}

/**
 * Soft-cancel a task. We don't hard-delete — audit trail would be lost.
 */
export async function cancelTask(taskId: string, actor: { id: string }) {
  return updateStatus(taskId, "CANCELLED", actor);
}

/**
 * Patch the editable metadata of a task (title/description/priority/due etc).
 * Writes appropriate TaskEvent rows for non-trivial changes so the timeline
 * reflects *why* a task looks the way it does, not just the current snapshot.
 */
export async function updateTaskFields(
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    categoryId?: string | null;
    labels?: string[];
    dueDate?: Date | null;
    remindAt?: Date | null;
    moduleContext?: string | null;
  },
  actor: { id: string }
) {
  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      publicId: true,
      priority: true,
      dueDate: true,
    },
  });
  if (!before) return null;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: patch.title,
      description: patch.description ?? undefined,
      priority: patch.priority,
      categoryId: patch.categoryId ?? undefined,
      labels: patch.labels,
      dueDate: patch.dueDate ?? undefined,
      remindAt: patch.remindAt ?? undefined,
      moduleContext: patch.moduleContext ?? undefined,
      // Resetting reminderSentAt when remindAt moves forward lets the same
      // task re-remind after its deadline is pushed.
      ...(patch.remindAt && patch.remindAt > new Date()
        ? { reminderSentAt: null }
        : {}),
    },
    include: TASK_WITH_RELATIONS,
  });

  const events: Array<{
    kind: "PRIORITY_CHANGED" | "DUE_DATE_CHANGED";
    metadata: Record<string, unknown>;
  }> = [];
  if (patch.priority && patch.priority !== before.priority) {
    events.push({
      kind: "PRIORITY_CHANGED",
      metadata: { from: before.priority, to: patch.priority },
    });
  }
  const beforeDueIso = before.dueDate ? before.dueDate.toISOString() : null;
  const afterDueIso = patch.dueDate ? patch.dueDate.toISOString() : null;
  if (patch.dueDate !== undefined && beforeDueIso !== afterDueIso) {
    events.push({
      kind: "DUE_DATE_CHANGED",
      metadata: { from: beforeDueIso, to: afterDueIso },
    });
  }

  for (const ev of events) {
    await prisma.taskEvent.create({
      data: {
        taskId,
        kind: ev.kind,
        actorUserId: actor.id,
        metadata: ev.metadata as Prisma.InputJsonValue,
      },
    });
  }

  await logAudit(actor.id, "task.update", "Task", taskId, {
    publicId: before.publicId,
    changed: Object.keys(patch),
  });

  return updated;
}
