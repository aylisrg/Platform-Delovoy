import { z } from "zod";

/**
 * Клиентский error-beacon (см. docs/incidents/2026-07-06-availability-diagnosis.md,
 * дополнение 2026-07-20): браузерные ошибки пользователей публичного сайта
 * невидимы серверному мониторингу — бикон доставляет их в SystemEvent.
 * Лимиты длин жёсткие: эндпоинт публичный, содержимое не доверенное.
 */
export const clientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  source: z.enum(["window-error", "unhandled-rejection"]),
  url: z.string().max(300).optional(),
  userAgent: z.string().max(300).optional(),
});

export type ClientErrorInput = z.infer<typeof clientErrorSchema>;
