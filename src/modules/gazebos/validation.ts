import { z } from "zod";
import { bookingItemSchema } from "@/modules/inventory/validation";

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
  items: z.array(bookingItemSchema).max(20).optional(),
  // Guest checkout fields — populated when the caller is not authenticated.
  // The route handler enforces "session OR (guestName + guestPhone)";
  // at the schema level we only validate shape so authed callers don't need to send them.
  guestName: z.string().min(1, "Имя обязательно").max(200).optional(),
  guestPhone: z.string().min(1, "Телефон обязателен").max(30).optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);

export const bookingFilterSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  resourceId: z.string().optional(),
  dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
  userId: z.string().optional(),
});

export const availabilityQuerySchema = z.object({
  resourceId: z.string().optional(),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});

export const timelineQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});

export const analyticsQuerySchema = z.object({
  period: z.enum(["week", "month", "quarter"]).default("month"),
});

/**
 * Notification types that can be toggled for the dedicated gazebos Telegram
 * channel. Single source of truth for the validation schema, the admin UI
 * checkboxes, and the channel dispatcher templates.
 */
export const GAZEBO_CHANNEL_EVENT_TYPES = [
  "booking.created",
  "booking.confirmed",
  "booking.updated",
  "booking.cancelled",
  "booking.completed",
  "booking.deleted",
  "booking.reminder",
] as const;

export type GazeboChannelEventType = (typeof GAZEBO_CHANNEL_EVENT_TYPES)[number];

export const GAZEBO_CHANNEL_EVENTS: {
  type: GazeboChannelEventType;
  label: string;
}[] = [
  { type: "booking.created", label: "Новая бронь" },
  { type: "booking.confirmed", label: "Бронь подтверждена" },
  { type: "booking.updated", label: "Бронь изменена" },
  { type: "booking.cancelled", label: "Бронь отменена" },
  { type: "booking.completed", label: "Бронь завершена" },
  { type: "booking.deleted", label: "Бронь удалена" },
  { type: "booking.reminder", label: "Напоминание (за 1 час)" },
];

export const moduleSettingsSchema = z.object({
  openHour: z.number().int().min(0).max(23).optional(),
  closeHour: z.number().int().min(0).max(23).optional(),
  minBookingHours: z.number().int().min(1).max(24).optional(),
  maxBookingHours: z.number().int().min(1).max(24).optional(),
  maxDiscountPercent: z.number().int().min(1).max(100).optional(),
  // Dedicated gazebos Telegram channel settings (stored in Module.config).
  telegramChannelEnabled: z.boolean().optional(),
  telegramChannelName: z.string().max(200).optional(),
  telegramChannelId: z.string().max(64).optional(), // empty string clears it
  telegramChannelEvents: z
    .array(z.enum(GAZEBO_CHANNEL_EVENT_TYPES))
    .optional(),
});

/**
 * Test-message request for the dedicated Telegram channel.
 * chatId lets the admin test the value currently typed in the form
 * before saving; falls back to the saved Module.config.telegramChannelId.
 */
export const channelTestMessageSchema = z.object({
  chatId: z.string().max(64).optional(),
});

/**
 * Partial edit of an existing booking's details (admin/manager action).
 * All fields optional; at least one must be present. Scheduling fields are
 * re-validated server-side (conflict, min duration, capacity).
 */
export const updateBookingDetailsSchema = z
  .object({
    resourceId: z.string().min(1).optional(),
    date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
    startTime: z.string().regex(timeRegex, "Формат времени: HH:mm").optional(),
    endTime: z.string().regex(timeRegex, "Формат времени: HH:mm").optional(),
    guestCount: z.number().int().positive().optional(),
    comment: z.string().max(500).optional(),
    clientName: z.string().min(1, "Имя клиента обязательно").max(200).optional(),
    clientPhone: z.string().min(1, "Телефон клиента обязателен").max(30).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Укажите хотя бы одно поле для изменения",
  })
  .refine((d) => !(d.startTime && d.endTime) || d.startTime < d.endTime, {
    message: "Время начала должно быть раньше времени окончания",
    path: ["endTime"],
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
  items: z.array(bookingItemSchema).max(20).optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);
