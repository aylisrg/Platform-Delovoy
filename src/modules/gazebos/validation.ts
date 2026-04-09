import { z } from "zod";

export const createResourceSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  description: z.string().max(500).optional(),
  capacity: z.number().int().positive("Вместимость должна быть положительной").optional(),
  pricePerHour: z.number().positive("Цена должна быть положительной").optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateResourceSchema = createResourceSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createBookingSchema = z.object({
  resourceId: z.string().min(1, "ID ресурса обязателен"),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  endTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  guestCount: z.number().int().positive().optional(),
  comment: z.string().max(500).optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);

export const bookingFilterSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"]).optional(),
  resourceId: z.string().optional(),
  dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  userId: z.string().optional(),
});

export const availabilityQuerySchema = z.object({
  resourceId: z.string().optional(),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});

export const adminCreateBookingSchema = z.object({
  resourceId: z.string().min(1, "ID ресурса обязателен"),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  endTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  guestCount: z.number().int().positive().optional(),
  comment: z.string().max(500).optional(),
  clientName: z.string().min(1, "Имя клиента обязательно").max(200),
  clientPhone: z.string().min(1, "Телефон клиента обязателен").max(30),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);
