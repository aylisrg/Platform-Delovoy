import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const updateModuleConfigSchema = z
  .object({
    isActive: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => data.isActive !== undefined || data.config !== undefined, {
    message: "Необходимо указать хотя бы одно поле: isActive или config",
  });

export const auditFilterSchema = z.object({
  userId: z.string().optional(),
  entity: z.string().optional(),
  action: z.string().optional(),
  dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const analyticsQuerySchema = z.object({
  dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
});

export const eventsFilterSchema = z.object({
  level: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]).optional(),
  source: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
