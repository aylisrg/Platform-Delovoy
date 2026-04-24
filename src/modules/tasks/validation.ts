import { z } from "zod";

// Keep enum literals in sync with prisma/schema.prisma. Using `z.enum` with
// string literals avoids pulling prisma types into client-side validation.

export const TaskTypeSchema = z.enum(["INTERNAL", "ISSUE"]);
export const TaskSourceSchema = z.enum(["MANUAL", "TELEGRAM", "EMAIL", "WEB", "API"]);
export const TaskStatusSchema = z.enum([
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);
export const TaskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const TaskCommentSourceSchema = z.enum(["WEB", "TELEGRAM", "EMAIL", "API"]);

const TitleSchema = z.string().trim().min(2, "Слишком короткий заголовок").max(200);
const DescriptionSchema = z.string().trim().max(20_000).optional().nullable();
const LabelsSchema = z.array(z.string().trim().min(1).max(50)).max(20).default([]);

export const CreateTaskSchema = z.object({
  type: TaskTypeSchema.default("INTERNAL"),
  source: TaskSourceSchema.default("MANUAL"),
  moduleContext: z.string().trim().min(1).max(50).optional().nullable(),
  title: TitleSchema,
  description: DescriptionSchema,
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  categoryId: z.string().cuid().optional().nullable(),
  labels: LabelsSchema,
  assigneeUserId: z.string().cuid().optional().nullable(),
  reporterUserId: z.string().cuid().optional().nullable(),
  externalTenantId: z.string().cuid().optional().nullable(),
  externalOfficeId: z.string().cuid().optional().nullable(),
  externalContact: z
    .object({
      name: z.string().trim().max(200).optional(),
      email: z.string().trim().email().max(200).optional(),
      phone: z.string().trim().max(50).optional(),
      telegramHandle: z.string().trim().max(100).optional(),
    })
    .optional()
    .nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  remindAt: z.coerce.date().optional().nullable(),
  emailThreadId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  // Type/source shouldn't change after creation
}).omit({ type: true, source: true });

export const UpdateStatusSchema = z.object({
  status: TaskStatusSchema,
});

export const UpdateAssigneeSchema = z.object({
  assigneeUserId: z.string().cuid().nullable(),
});

export const CreateCommentSchema = z.object({
  body: z.string().trim().min(1, "Пустой комментарий").max(10_000),
  source: TaskCommentSourceSchema.default("WEB"),
});

export const ListTasksSchema = z.object({
  type: TaskTypeSchema.optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  categoryId: z.string().cuid().optional(),
  assigneeUserId: z.string().cuid().optional(),
  moduleContext: z.string().trim().min(1).max(50).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const CreateCategorySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "slug — только латиница, цифры и дефис"),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  defaultAssigneeUserId: z.string().cuid().optional().nullable(),
  keywords: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const UpdateCategorySchema = CreateCategorySchema.partial().omit({ slug: true });

export const PublicReportSchema = z.object({
  name: z.string().trim().min(2).max(200),
  contactEmail: z.string().trim().email().max(200).optional(),
  contactPhone: z.string().trim().min(5).max(50).optional(),
  officeInput: z.string().trim().min(1).max(100),
  // When the frontend resolved an exact office via autosuggest, it may pass
  // the concrete ID — the backend still cross-checks.
  officeId: z.string().cuid().optional().nullable(),
  categorySlug: z.string().trim().min(2).max(50).optional(),
  description: z.string().trim().min(5).max(5_000),
  photoUrl: z.string().trim().url().max(500).optional(),
}).refine(
  (d) => !!(d.contactEmail || d.contactPhone),
  { message: "Укажите email или телефон", path: ["contactEmail"] }
);

export const OfficeSearchSchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export const SubscribeSchema = z.object({
  channels: z.array(z.enum(["TELEGRAM", "EMAIL"])).min(1).default(["TELEGRAM", "EMAIL"]),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
export type ListTasksInput = z.infer<typeof ListTasksSchema>;
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type PublicReportInput = z.infer<typeof PublicReportSchema>;
