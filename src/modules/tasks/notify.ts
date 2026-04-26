import { prisma } from "@/lib/db";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import type { NotificationPayload } from "@/modules/notifications/dispatch/types";
import type { TaskAssigneeRole } from "@prisma/client";

/**
 * Per-event role matrix from PRD §6.2.
 * `true` = role receives notification for this eventType.
 */
const ROLE_MATRIX: Record<string, Record<TaskAssigneeRole | "REPORTER", boolean>> = {
  "task.created": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: false,
    REPORTER: false,
  },
  "task.updated": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: false,
    REPORTER: false,
  },
  "task.column_changed": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: true,
    REPORTER: false,
  },
  "task.closed": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: true,
    REPORTER: true,
  },
  "task.commented": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: false,
    REPORTER: false,
  },
  "task.commented_visible_to_reporter": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: false,
    REPORTER: true,
  },
  "task.assignee_added": {
    RESPONSIBLE: true,
    COLLABORATOR: true,
    WATCHER: false,
    REPORTER: false,
  },
  "task.mention": {
    RESPONSIBLE: false,
    COLLABORATOR: false,
    WATCHER: false,
    REPORTER: false,
  },
};

export type DispatchTaskEventInput = {
  taskId: string;
  eventType: string;
  actorUserId: string | null;
  payload: NotificationPayload;
  /** When true, also include reporter regardless of matrix */
  notifyReporter?: boolean;
  /** Explicit user list (overrides matrix). Used for mentions. */
  recipientUserIds?: string[];
};

/**
 * Fan out a task event to relevant recipients via NotificationDispatcher.
 * Errors are swallowed and logged — caller is fire-and-forget.
 */
export async function dispatchTaskEvent(input: DispatchTaskEventInput): Promise<void> {
  try {
    let userIds: Set<string>;
    if (input.recipientUserIds?.length) {
      userIds = new Set(input.recipientUserIds);
    } else {
      userIds = await resolveRecipientsByMatrix(
        input.taskId,
        input.eventType,
        input.notifyReporter
      );
    }
    // never notify the actor themselves
    if (input.actorUserId) userIds.delete(input.actorUserId);

    await Promise.all(
      [...userIds].map((userId) =>
        dispatch({
          userId,
          eventType: input.eventType,
          entityType: "Task",
          entityId: input.taskId,
          payload: input.payload,
        }).catch((err) => {
          console.error("[tasks/notify] dispatch failed", { userId, err });
        })
      )
    );
  } catch (err) {
    console.error("[tasks/notify] fan-out failed", err);
  }
}

async function resolveRecipientsByMatrix(
  taskId: string,
  eventType: string,
  notifyReporter: boolean | undefined
): Promise<Set<string>> {
  const matrix = ROLE_MATRIX[eventType];
  const out = new Set<string>();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      reporterUserId: true,
      assignees: { select: { userId: true, role: true } },
    },
  });
  if (!task) return out;

  for (const a of task.assignees) {
    const allow = matrix?.[a.role] ?? false;
    if (allow) out.add(a.userId);
  }
  const reporterAllowed = (matrix?.REPORTER ?? false) || notifyReporter === true;
  if (reporterAllowed && task.reporterUserId) {
    out.add(task.reporterUserId);
  }

  // Explicit subscribers via TaskSubscription
  const subs = await prisma.taskSubscription.findMany({
    where: {
      OR: [{ scope: "TASK", taskId }],
    },
    select: { userId: true },
  });
  for (const s of subs) out.add(s.userId);

  return out;
}
