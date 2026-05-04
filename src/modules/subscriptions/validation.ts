import { z } from "zod";

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const createSubscriptionSchema = z
  .object({
    userId: z.string().min(1, "Гость обязателен"),
    totalHours: z
      .number()
      .positive("Часы должны быть > 0")
      .multipleOf(0.25, "Шаг 0.25 ч (15 мин)"),
    pricePaid: z.number().min(0, "Цена не может быть отрицательной"),
    validFrom: isoDate,
    validTo: isoDate,
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((d) => new Date(d.validFrom) < new Date(d.validTo), {
    message: "Дата окончания должна быть позже даты начала",
    path: ["validTo"],
  });

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const updateSubscriptionSchema = z
  .object({
    notes: z.string().max(2000).optional().nullable(),
    pricePaid: z.number().min(0).optional(),
  })
  .strict();

export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

export const adjustHoursSchema = z.object({
  type: z.enum(["MANUAL_TOPUP", "MANUAL_DEDUCT"]),
  hours: z
    .number()
    .positive("Часы должны быть > 0")
    .multipleOf(0.25, "Шаг 0.25 ч"),
  reason: z
    .string()
    .trim()
    .min(3, "Минимум 3 символа")
    .max(500, "Максимум 500 символов"),
});

export type AdjustHoursInput = z.infer<typeof adjustHoursSchema>;

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

export const listSubscriptionsSchema = z.object({
  status: z
    .enum(["ACTIVE", "EXPIRED", "DEPLETED", "CANCELLED"])
    .optional(),
  userId: z.string().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListSubscriptionsFilter = z.infer<typeof listSubscriptionsSchema>;
