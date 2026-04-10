import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const clientFilterSchema = z.object({
  search: z.string().max(200).optional(),
  moduleSlug: z.enum(["gazebos", "ps-park", "cafe"]).optional(),
  dateFrom: z
    .string()
    .regex(dateRegex, "Формат даты: YYYY-MM-DD")
    .optional(),
  dateTo: z
    .string()
    .regex(dateRegex, "Формат даты: YYYY-MM-DD")
    .optional(),
  sortBy: z
    .enum(["totalSpent", "lastActivity", "createdAt", "name"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ClientFilterInput = z.infer<typeof clientFilterSchema>;
