import { z } from "zod";

export const taskPriorityEnum = z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const taskSourceEnum = z.enum(["MANUAL", "TELEGRAM", "EMAIL", "WEB", "API"]);
export const taskAssigneeRoleEnum = z.enum(["RESPONSIBLE", "COLLABORATOR", "WATCHER"]);

const labelString = z.string().trim().min(1).max(40);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).optional(),
  boardId: z.string().cuid().optional(),
  columnId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  priority: taskPriorityEnum.optional(),
  dueAt: z.coerce.date().nullable().optional(),
  labels: z.array(labelString).max(20).optional(),
  source: taskSourceEnum.optional(),
  reporterUserId: z.string().cuid().nullable().optional(),
  responsibleUserId: z.string().cuid().nullable().optional(),
  collaboratorUserIds: z.array(z.string().cuid()).max(10).optional(),
  watcherUserIds: z.array(z.string().cuid()).max(20).optional(),
  officeId: z.string().cuid().nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(20000).nullable(),
    categoryId: z.string().cuid().nullable(),
    priority: taskPriorityEnum,
    dueAt: z.coerce.date().nullable(),
    labels: z.array(labelString).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "no fields" });

export const moveTaskColumnSchema = z.object({
  columnId: z.string().cuid(),
  sortOrder: z.number().finite().optional(),
});

export const reorderTaskSchema = z.object({
  sortOrder: z.number().finite(),
});

export const addAssigneeSchema = z.object({
  userId: z.string().cuid(),
  role: taskAssigneeRoleEnum,
  demoteCurrent: z.boolean().optional(),
});

export const updateAssigneeRoleSchema = z.object({
  role: taskAssigneeRoleEnum,
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  visibleToReporter: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        filename: z.string().min(1).max(255),
        size: z.number().int().nonnegative().optional(),
        mimeType: z.string().max(100).optional(),
      })
    )
    .max(10)
    .optional(),
  inReplyToCommentId: z.string().cuid().optional(),
});

export const taskListQuerySchema = z.object({
  boardId: z.string().cuid().optional(),
  columnId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  assigneeRole: taskAssigneeRoleEnum.optional(),
  source: taskSourceEnum.optional(),
  priority: z.array(taskPriorityEnum).optional(),
  labels: z.array(labelString).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const e164 = /^\+?[1-9]\d{6,14}$/;

export const reportTaskSchema = z
  .object({
    description: z.string().trim().min(10).max(2000),
    title: z.string().trim().min(1).max(200).optional(),
    officeNumber: z.string().trim().max(50).optional(),
    officeId: z.string().cuid().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().regex(e164, "phone must be E.164").optional(),
    category: z.string().trim().min(1).max(80).optional(),
    ambiguityResolution: z.enum(["specific", "unknown"]).optional(),
  })
  .refine((v) => !!(v.email || v.phone), {
    message: "email or phone required",
    path: ["email"],
  });

export const officeSuggestSchema = z.object({
  q: z.string().trim().min(1).max(50),
});

export const boardSchema = z.object({
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "slug: a-z0-9-"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const columnSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "color must be hex #RRGGBB")
    .optional(),
  sortOrder: z.number().int().optional(),
  isTerminal: z.boolean().optional(),
  wipLimit: z.number().int().min(1).max(1000).nullable().optional(),
});

export const categorySchema = z.object({
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "slug: a-z0-9-"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "color must be hex #RRGGBB")
    .optional(),
  defaultBoardId: z.string().cuid().nullable().optional(),
  defaultResponsibleUserId: z.string().cuid().nullable().optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  priorityHint: taskPriorityEnum.optional(),
  sortOrder: z.number().int().optional(),
});

export const savedViewSchema = z.object({
  boardId: z.string().cuid().nullable().optional(),
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().optional(),
});

export type CreateTaskPayload = z.infer<typeof createTaskSchema>;
export type UpdateTaskPayload = z.infer<typeof updateTaskSchema>;
export type ReportTaskPayload = z.infer<typeof reportTaskSchema>;
export type CreateCommentPayload = z.infer<typeof createCommentSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
