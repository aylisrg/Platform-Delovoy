import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createTableSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  description: z.string().max(500).optional(),
  capacity: z.number().int().positive().optional(),
  pricePerHour: z.number().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateTableSchema = createTableSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createPSBookingSchema = z.object({
  resourceId: z.string().min(1, "ID стола обязателен"),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  endTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  playerCount: z.number().int().positive().optional(),
  comment: z.string().max(500).optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);

export const psBookingFilterSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"]).optional(),
  resourceId: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  userId: z.string().optional(),
});

export const psAvailabilityQuerySchema = z.object({
  resourceId: z.string().optional(),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});
