import { z } from "zod";

export const refundRequestSchema = z.object({
  reason: z
    .string()
    .min(3, "Причина возврата обязательна (минимум 3 символа)")
    .max(300, "Причина возврата — максимум 300 символов"),
});

export const paymentsListQuerySchema = z.object({
  status: z
    .enum([
      "PENDING",
      "WAITING_FOR_CAPTURE",
      "SUCCEEDED",
      "CANCELED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
    ])
    .optional(),
  moduleSlug: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});
