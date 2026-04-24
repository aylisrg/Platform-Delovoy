// Shared types for the tasks module.
// Reuse Prisma-generated enums where possible so the compiler enforces drift.

import type {
  TaskType,
  TaskSource,
  TaskStatus,
  TaskPriority,
  TaskEventKind,
  TaskCommentSource,
} from "@prisma/client";

export type {
  TaskType,
  TaskSource,
  TaskStatus,
  TaskPriority,
  TaskEventKind,
  TaskCommentSource,
};

export type ExternalContact = {
  name?: string;
  email?: string;
  phone?: string;
  telegramHandle?: string;
};

/** Slug used by Module.config to store tasks-module settings (e.g. fallback assignee). */
export const TASKS_MODULE_SLUG = "tasks";

/** Key for the global fallback-assignee user id inside Module.config JSON. */
export const TASKS_FALLBACK_ASSIGNEE_KEY = "fallbackAssigneeUserId";
