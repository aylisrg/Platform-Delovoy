import { z } from "zod";
import { bookingItemSchema } from "@/modules/inventory/validation";

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
  items: z.array(bookingItemSchema).max(20).optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);

export const adminCreatePSBookingSchema = z.object({
  resourceId: z.string().min(1, "ID стола обязателен"),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  endTime: z.string().regex(timeRegex, "Формат времени: HH:mm"),
  playerCount: z.number().int().positive().optional(),
  comment: z.string().max(500).optional(),
  clientName: z.string().min(1, "Имя клиента обязательно").max(200),
  clientPhone: z.string().min(1).max(30).optional(),
  // Контакт для чека — не создаёт учётную запись и не способ входа (#665).
  email: z.string().email("Некорректный email").max(200).optional(),
  items: z.array(bookingItemSchema).max(20).optional(),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: "Время начала должно быть раньше времени окончания", path: ["endTime"] }
);

export const psBookingFilterSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  resourceId: z.string().optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  userId: z.string().optional(),
  // Поиск по имени/телефону гостя (#438) — contains-insensitive в service.ts.
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export const psAvailabilityQuerySchema = z.object({
  resourceId: z.string().optional(),
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});

export const addBookingItemsSchema = z.object({
  items: z.array(bookingItemSchema).min(1, "Нужно выбрать хотя бы один товар").max(20),
});

export const timelineQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});

export const analyticsQuerySchema = z.object({
  period: z.enum(["week", "month", "quarter"]).default("month"),
});

/**
 * Типы событий выделенного Telegram-канала PS Park (зеркало gazebos).
 * В канал шлём только «оплаченные» сессии (booking.paid) + сервисные события.
 * booking.admin_created — бронь по телефону, создаётся сразу CONFIRMED и без
 * неё не попадала бы в канал (#437, зеркало gazebos).
 */
export const PS_PARK_CHANNEL_EVENT_TYPES = [
  "booking.paid",
  "booking.admin_created",
  "booking.cancelled",
  "booking.completed",
  "booking.reminder",
] as const;

export type PSParkChannelEventType = (typeof PS_PARK_CHANNEL_EVENT_TYPES)[number];

export const PS_PARK_CHANNEL_EVENTS: {
  type: PSParkChannelEventType;
  label: string;
}[] = [
  { type: "booking.paid", label: "Оплачено онлайн" },
  { type: "booking.admin_created", label: "Бронь по телефону (админом)" },
  { type: "booking.cancelled", label: "Сессия отменена" },
  { type: "booking.completed", label: "Сессия завершена" },
  { type: "booking.reminder", label: "Напоминание (за 1 час)" },
];

export const moduleSettingsSchema = z.object({
  openHour: z.number().int().min(0).max(23).optional(),
  closeHour: z.number().int().min(0).max(23).optional(),
  minBookingHours: z.number().int().min(1).max(24).optional(),
  slotRoundingMinutes: z.number().int().min(1).max(60).optional(),
  sessionAlertMinutes: z.number().int().min(1).max(60).optional(),
  maxDiscountPercent: z.number().int().min(1).max(100).optional(),
  // Порог неявки (минут после startTime) — раньше захардкожен `30` (#440).
  noShowThresholdMinutes: z.number().int().min(1).max(1440).optional(),
  // Выделенный Telegram-канал PS Park (хранится в Module.config).
  telegramChannelEnabled: z.boolean().optional(),
  telegramChannelName: z.string().max(200).optional(),
  telegramChannelId: z.string().max(64).optional(), // пустая строка очищает
  telegramChannelEvents: z
    .array(z.enum(PS_PARK_CHANNEL_EVENT_TYPES))
    .optional(),
});

/** Тест-сообщение в канал: chatId для проверки значения до сохранения. */
export const channelTestMessageSchema = z.object({
  chatId: z.string().max(64).optional(),
});

/**
 * Алерт «сессия заканчивается» из админ-панели.
 * Длины ограничены жёстко: значения уходят в текст Telegram-сообщения, и без
 * потолка одним запросом можно забить админ-чат простынёй.
 */
export const sessionEndingAlertSchema = z.object({
  bookingId: z.string().min(1, "ID брони обязателен").max(64),
  resourceName: z.string().min(1, "Название стола обязательно").max(100),
  // nullish, а не optional: до фикса роут терпел любой clientName, включая null,
  // и админ-панель шлёт его как есть. Строгий optional превратил бы отсутствие
  // имени клиента в 422 и потерю алерта — регрессия, которую типы не поймают.
  clientName: z.string().max(200).nullish(),
  remainingMinutes: z.number().int().min(0).max(600).nullish(),
});


/**
 * Передача наличной выручки смены в бухгалтерию (инкассация).
 *
 * `recipient` — свободный текст: у бухгалтера нет входа в систему, поэтому
 * подтверждать приём внутри платформы некому. Обязательность пояснения при
 * расхождении проверяет сервис — там известна расчётная сумма.
 */
export const shiftHandoverSchema = z.object({
  amount: z
    .number()
    .min(0, "Сумма не может быть отрицательной")
    .max(100_000_000, "Сумма слишком велика"),
  recipient: z
    .string()
    .min(2, "Укажите, кому передали деньги")
    .max(200, "Слишком длинное имя получателя"),
  note: z
    .string()
    .max(500, "Максимальная длина пояснения — 500 символов")
    .nullish()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  /**
   * Осознанное исправление уже записанной передачи. Без этого флага повторный
   * вызов отклоняется: тихо переписать запись о деньгах нельзя.
   */
  isCorrection: z.boolean().nullish().transform((v) => v ?? false),
});

export type ShiftHandoverInput = z.infer<typeof shiftHandoverSchema>;
