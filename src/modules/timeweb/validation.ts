import { z } from "zod";

export const powerActionSchema = z.object({
  action: z.enum(["start", "shutdown", "reboot", "hard-reboot"], {
    required_error: "Действие обязательно",
    invalid_type_error: "Недопустимое действие",
  }),
});

export const statsQuerySchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Формат даты: YYYY-MM-DD")
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Формат даты: YYYY-MM-DD")
    .optional(),
});

export const logsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(100),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
});
