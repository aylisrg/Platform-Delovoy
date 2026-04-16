import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const periodSchema = z.enum(["today", "7d", "30d"]);

export const analyticsQuerySchema = z
  .object({
    dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
    dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
    period: periodSchema.optional(),
    forceRefresh: z.preprocess(
      (val) => val === "true" || val === true,
      z.boolean().default(false)
    ),
  })
  .refine(
    (data) => {
      if (data.dateFrom && data.dateTo) {
        return data.dateFrom <= data.dateTo;
      }
      return true;
    },
    { message: "dateFrom не может быть позже dateTo" }
  )
  .refine(
    (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.dateTo && data.dateTo > today) return false;
      if (data.dateFrom && data.dateFrom > today) return false;
      return true;
    },
    { message: "Даты не могут быть в будущем" }
  );

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
