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
  // Контакт для чека 54-ФЗ при онлайн-оплате.
  email: z.string().email("Некорректный email").max(200).optional(),
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
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
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
// В канал шлём только «оплаченные» брони (booking.paid) — booking.created/
// booking.confirmed убраны, чтобы неоплаченные (PENDING) брони не попадали
// в канал и не было двойного поста confirmed+paid.
export const GAZEBO_CHANNEL_EVENT_TYPES = [
  "booking.paid",
  "booking.cancelled",
  "booking.completed",
  "booking.deleted",
  "booking.reminder",
  "booking.ending_soon",
] as const;

export type GazeboChannelEventType = (typeof GAZEBO_CHANNEL_EVENT_TYPES)[number];

export const GAZEBO_CHANNEL_EVENTS: {
  type: GazeboChannelEventType;
  label: string;
}[] = [
  { type: "booking.paid", label: "Оплачено онлайн" },
  { type: "booking.cancelled", label: "Бронь отменена" },
  { type: "booking.completed", label: "Бронь завершена" },
  { type: "booking.deleted", label: "Бронь удалена" },
  { type: "booking.reminder", label: "Напоминание (за 1 час до начала)" },
  { type: "booking.ending_soon", label: "Продление (за 1 час до конца)" },
];

export const moduleSettingsSchema = z.object({
  openHour: z.number().int().min(0).max(23).optional(),
  closeHour: z.number().int().min(0).max(23).optional(),
  minBookingHours: z.number().int().min(1).max(24).optional(),
  maxBookingHours: z.number().int().min(1).max(24).optional(),
  maxDiscountPercent: z.number().int().min(1).max(100).optional(),
  // Публичная бронь беседок с сайта. false — временно закрыта (админ-бронь
  // при этом продолжает работать). Дефолт (отсутствие ключа) = включено.
  publicBookingEnabled: z.boolean().optional(),
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
 * Редактирование существующей брони админом (время / ресурс / клиент).
 * Все поля опциональны — можно менять только время; но хотя бы одно поле
 * должно присутствовать. При изменении времени/даты/ресурса цена
 * пересчитывается на сервере (учёт выходных), а факт правки логируется.
 */
export const rescheduleBookingSchema = z
  .object({
    resourceId: z.string().min(1).optional(),
    date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
    startTime: z.string().regex(timeRegex, "Формат времени: HH:mm").optional(),
    endTime: z.string().regex(timeRegex, "Формат времени: HH:mm").optional(),
    clientName: z.string().min(1).max(200).optional(),
    clientPhone: z.string().min(1).max(30).optional(),
    guestCount: z.number().int().positive().optional(),
  })
  .refine(
    (d) => !(d.startTime && d.endTime) || d.startTime < d.endTime,
    { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
  )
  .refine(
    (d) =>
      d.resourceId !== undefined ||
      d.date !== undefined ||
      d.startTime !== undefined ||
      d.endTime !== undefined ||
      d.clientName !== undefined ||
      d.clientPhone !== undefined ||
      d.guestCount !== undefined,
    { message: "Нет изменений для сохранения" }
  );

export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

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
