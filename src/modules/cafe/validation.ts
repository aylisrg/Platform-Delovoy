import { z } from "zod";

/** Внешний URL или наш served-путь загруженного фото позиции. */
const imageUrlSchema = z.union([
  z.string().url(),
  z.string().regex(/^\/api\/cafe\/menu\/images\/[\w.-]+$/, "Некорректный путь изображения"),
]);

export const createMenuItemSchema = z.object({
  category: z.string().min(1, "Категория обязательна").max(100),
  name: z.string().min(1, "Название обязательно").max(200),
  description: z.string().max(500).optional(),
  price: z.number().positive("Цена должна быть положительной"),
  imageUrl: imageUrlSchema.optional(),
  sortOrder: z.number().int().optional(),
});

export const updateMenuItemSchema = createMenuItemSchema.partial().extend({
  isAvailable: z.boolean().optional(),
});

export const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().positive("Количество должно быть положительным"),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Заказ должен содержать хотя бы один товар"),
  deliveryTo: z.string().max(50).optional(),
  comment: z.string().max(500).optional(),
  bookingId: z.string().cuid("bookingId должен быть валидным CUID").optional(),
});

/**
 * Публичный QR-чекаут. Контакт для чека 54-ФЗ опционален на уровне схемы:
 * обязательность при включённой фискализации проверяет сервис платежей
 * (PAYMENT_CONTACT_REQUIRED) — единственный источник знания об этом режиме.
 */
export const checkoutSchema = createOrderSchema.omit({ bookingId: true }).extend({
  customerEmail: z.string().email("Некорректный email").max(200).optional(),
  customerPhone: z
    .string()
    .max(30)
    .regex(/^[\d\s()+-]{6,}$/, "Некорректный телефон")
    .optional(),
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const orderFilterSchema = z.object({
  status: z.enum(["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"]).optional(),
  userId: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  paid: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export const statsQuerySchema = z
  .object({
    dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
    dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  })
  .refine((q) => q.dateFrom <= q.dateTo, {
    message: "dateFrom должна быть не позже dateTo",
  });
