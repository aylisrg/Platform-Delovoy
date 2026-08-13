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

/** Статусы брони (зеркало enum BookingStatus в prisma/schema.prisma). */
export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

/**
 * Суммы кассовой разбивки. `min(0)` — главное: до фикса #432 роуты принимали
 * тело ad-hoc `typeof`-проверками, и пара `cashAmount=2000, cardAmount=-1000`
 * при счёте 1000 проходила гейт PAYMENT_REQUIRED (сумма сходится), а в
 * FinancialTransaction уезжала разбивка с отрицательной картой — сверка смены
 * (`getDayReport`/`closeShift`) получалась искажённой.
 *
 * `nullish` вместо `optional`: клиенты присылают отсутствующую сумму и как
 * пропуск ключа, и как `null`; строгий optional превратил бы второй случай
 * в 422 на завершении брони.
 */
const paymentAmountSchema = z
  .number()
  .min(0, "Сумма оплаты не может быть отрицательной")
  .max(10_000_000, "Сумма оплаты слишком велика")
  .nullish()
  .transform((v) => v ?? undefined);

/**
 * Тело PATCH /api/{gazebos,ps-park}/bookings/:id в режиме смены статуса.
 * Общая схема для обоих модулей — разбивка «нал/карта» и переходы статусов
 * у них одинаковые. Поля скидки валидируются отдельно `checkoutDiscountSchema`
 * (только при COMPLETED), поэтому здесь их нет; неизвестные ключи Zod отбросит.
 */
export const updateBookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES, { error: "Недопустимый статус брони" }),
  reason: z
    .string()
    .max(500, "Максимальная длина причины — 500 символов")
    .nullish()
    .transform((v) => v ?? undefined),
  confirmPenalty: z.boolean().nullish(),
  cashAmount: paymentAmountSchema,
  cardAmount: paymentAmountSchema,
  // Абонемент PS Park: пустая строка = «без абонемента», как и отсутствие поля.
  subscriptionId: z
    .string()
    .max(64, "Некорректный ID абонемента")
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

/**
 * Восстановление ошибочно закрытой брони (#511). Пароль обязателен —
 * действие затрагивает деньги и расписание, поэтому строгость та же, что
 * у удаления данных (AC-7).
 */
export const restoreBookingSchema = z.object({
  password: z.string().min(1, "Введите пароль"),
  reason: z
    .string()
    .max(500, "Максимальная длина причины — 500 символов")
    .nullish()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
});

export type RestoreBookingRequest = z.infer<typeof restoreBookingSchema>;
