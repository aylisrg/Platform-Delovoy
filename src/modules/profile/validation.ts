import { z } from "zod";

export const updateNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Имя должно содержать минимум 2 символа")
    .max(100, "Имя не должно превышать 100 символов"),
});

export const attachEmailRequestSchema = z.object({
  email: z.string().email("Некорректный email-адрес").toLowerCase().trim(),
});

export const attachEmailConfirmSchema = z.object({
  token: z.string().min(1, "Токен обязателен"),
});

export const attachPhoneRequestSchema = z.object({
  phone: z
    .string()
    .min(10, "Некорректный номер телефона")
    .max(16, "Некорректный номер телефона"),
});

export const attachPhoneConfirmSchema = z.object({
  phone: z.string().min(10).max(16),
  code: z.string().length(6, "Код должен содержать 6 цифр"),
});

export const detachChannelSchema = z.object({
  channel: z.enum(["telegram", "email", "phone", "yandex"], {
    message: "Неподдерживаемый канал",
  }),
});

export const dashboardQuerySchema = z.object({
  section: z
    .enum(["overview", "bookings", "orders", "feedback", "profile"])
    .catch("overview"),
  history: z.enum(["active", "past"]).catch("active"),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});

export const ownBookingActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    confirmRefund: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("reschedule"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const d = new Date(value);
        return (
          Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
        );
      }, "Некорректная дата"),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  z.object({
    action: z.literal("pay"),
    acceptOffer: z.literal(true),
    offerVersionSlug: z.string().min(1).max(32),
    acceptMarketing: z.boolean().default(false),
  }),
]);
