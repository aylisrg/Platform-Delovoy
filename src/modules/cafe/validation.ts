import { z } from "zod";

export const createMenuItemSchema = z.object({
  category: z.string().min(1, "Категория обязательна").max(100),
  name: z.string().min(1, "Название обязательно").max(200),
  description: z.string().max(500).optional(),
  price: z.number().positive("Цена должна быть положительной"),
  imageUrl: z.string().url().optional(),
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
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const orderFilterSchema = z.object({
  status: z.enum(["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"]).optional(),
  userId: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
});
