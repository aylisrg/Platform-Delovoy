import { z } from "zod";

export const sendMagicLinkSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Пароль минимум 6 символов").optional(),
  /**
   * Куда вернуть после входа по ссылке из письма. Нормализуется на сервере
   * через safeCallbackUrl — схема проверяет только длину, решение «свой
   * путь или нет» принимает санитайзер, а не Zod.
   */
  callbackUrl: z.string().max(2048).optional(),
});

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
});

export type SendMagicLinkInput = z.infer<typeof sendMagicLinkSchema>;
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
