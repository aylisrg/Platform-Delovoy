import { z } from "zod";

export const updateNameSchema = z.object({
  name: z
    .string()
    .min(2, "Имя должно содержать минимум 2 символа")
    .max(100, "Имя не должно превышать 100 символов")
    .trim(),
});

export const attachEmailRequestSchema = z.object({
  email: z
    .string()
    .email("Некорректный email-адрес")
    .toLowerCase()
    .trim(),
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
    errorMap: () => ({ message: "Неподдерживаемый канал" }),
  }),
});
