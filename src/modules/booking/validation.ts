import { z } from "zod";
import { DISCOUNT_REASONS } from "./discount";

export const checkoutDiscountSchema = z
  .object({
    discountPercent: z
      .number()
      .int("Процент скидки должен быть целым числом")
      .min(1, "Минимальная скидка — 1%")
      .max(100, "Скидка не может превышать 100%"),
    discountReason: z
      .enum(DISCOUNT_REASONS, {
        error: "Выберите причину из списка",
      }),
    discountNote: z
      .string()
      .min(5, "Минимальная длина пояснения — 5 символов")
      .max(500, "Максимальная длина пояснения — 500 символов")
      .optional(),
  })
  .refine(
    (data) => {
      if (data.discountReason === "other" && (!data.discountNote || data.discountNote.length < 5)) {
        return false;
      }
      return true;
    },
    { message: "При выборе 'Другое' укажите пояснение (минимум 5 символов)", path: ["discountNote"] }
  );

export type CheckoutDiscountInput = z.infer<typeof checkoutDiscountSchema>;
