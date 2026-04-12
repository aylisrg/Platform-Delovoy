import { z } from "zod";

export const createSkuSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  category: z.string().min(1, "Категория обязательна").max(100),
  unit: z.string().max(20).default("шт"),
  price: z.number().positive("Цена должна быть положительной"),
  lowStockThreshold: z.number().int().nonnegative().default(5),
  initialStock: z.number().int().nonnegative().optional(),
});

export const updateSkuSchema = createSkuSchema
  .omit({ initialStock: true })
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });

const todayISO = () => new Date().toISOString().slice(0, 10);

export const receiveSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  quantity: z.number().int().positive("Количество должно быть положительным"),
  note: z.string().max(500).optional(),
  receivedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD")
    .refine((val) => val <= todayISO(), "Дата прихода не может быть в будущем")
    .optional(),
});

export const adjustSchema = z.object({
  skuId: z.string().min(1, "ID товара обязателен"),
  targetQuantity: z
    .number()
    .int()
    .nonnegative("Целевой остаток не может быть отрицательным"),
  note: z
    .string()
    .min(1, "Причина корректировки обязательна")
    .max(500),
});

export const voidTransactionSchema = z.object({
  note: z.string().max(500).optional(),
});

export const transactionFilterSchema = z.object({
  skuId: z.string().optional(),
  type: z
    .enum(["INITIAL", "RECEIPT", "SALE", "RETURN", "ADJUSTMENT"])
    .optional(),
  bookingId: z.string().optional(),
  moduleSlug: z.string().optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  isVoided: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(50),
});

export const analyticsQuerySchema = z.object({
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const skuFilterSchema = z.object({
  category: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

// Reusable booking item schema (used in ps-park and gazebos)
export const bookingItemSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const bookingItemsArraySchema = z
  .array(bookingItemSchema)
  .max(20, "Не более 20 позиций товаров");
