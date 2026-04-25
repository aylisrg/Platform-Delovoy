import { z } from "zod";

export const createFeedbackSchema = z.object({
  type: z.enum(["BUG", "SUGGESTION"], {
    message: "Тип обращения: BUG или SUGGESTION",
  }),
  description: z
    .string()
    .min(10, "Описание минимум 10 символов")
    .max(2000, "Описание максимум 2000 символов"),
  pageUrl: z
    .string()
    .min(1, "URL страницы обязателен")
    .max(2000),
  isUrgent: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
  officeId: z.preprocess(
    (val) =>
      typeof val === "string" && val.trim() === "" ? undefined : val,
    z
      .string()
      .cuid({ message: "Некорректный идентификатор офиса" })
      .optional()
  ),
});

export const feedbackFilterSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"]).optional(),
  type: z.enum(["BUG", "SUGGESTION"]).optional(),
  isUrgent: z
    .preprocess((val) => {
      if (val === "true") return true;
      if (val === "false") return false;
      return val;
    }, z.boolean().optional())
    .optional(),
});

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"]),
});

export const createCommentSchema = z.object({
  text: z
    .string()
    .min(1, "Комментарий не может быть пустым")
    .max(5000, "Комментарий максимум 5000 символов"),
});

export const SCREENSHOT_CONSTRAINTS = {
  maxSizeBytes: 5 * 1024 * 1024, // 5 MB
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  allowedExtensions: [".png", ".jpg", ".jpeg", ".webp"] as const,
};
