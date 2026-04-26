import type {
  Task,
  TaskAssignee,
  TaskBoard,
  TaskCategory,
  TaskColumn,
  TaskComment,
  TaskEvent,
  TaskAssigneeRole,
  TaskCommentSource,
  TaskEventKind,
  TaskPriority,
  TaskSource,
} from "@prisma/client";

export type {
  Task,
  TaskAssignee,
  TaskAssigneeRole,
  TaskBoard,
  TaskCategory,
  TaskColumn,
  TaskComment,
  TaskCommentSource,
  TaskEvent,
  TaskEventKind,
  TaskPriority,
  TaskSource,
};

export type ExternalContact = {
  name?: string;
  email?: string;
  phone?: string;
  officeNumber?: string;
};

export type TaskWithRelations = Task & {
  board: TaskBoard;
  column: TaskColumn;
  category: TaskCategory | null;
  assignees: (TaskAssignee & { user: { id: string; name: string | null; email: string | null } })[];
  _count?: { comments: number; events: number };
};

export type CreateTaskInput = {
  title: string;
  description?: string;
  boardId?: string;
  columnId?: string;
  categoryId?: string;
  priority?: TaskPriority;
  dueAt?: Date | string | null;
  labels?: string[];
  source?: TaskSource;
  reporterUserId?: string | null;
  externalContact?: ExternalContact | null;
  officeId?: string | null;
  responsibleUserId?: string | null;
  collaboratorUserIds?: string[];
  watcherUserIds?: string[];
};

export type UpdateTaskInput = Partial<{
  title: string;
  description: string | null;
  categoryId: string | null;
  priority: TaskPriority;
  dueAt: Date | string | null;
  labels: string[];
}>;

export type AccessMode = "read" | "write" | "manage" | "delete";
