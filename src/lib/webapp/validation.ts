import { z } from "zod";

/**
 * Zod-схемы запросов Mini App (ADR §3, §12).
 * Схема Центра уведомлений живёт в `src/modules/notifications/validation.ts`
 * (закрытый enum по каталогу) — здесь только слой /api/webapp/*.
 */

export const initDataAuthSchema = z.object({
  initData: z.string().min(1, "initData is required").max(8192),
});

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().datetime({ offset: true }).optional(),
});

export const feedReadSchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(100).optional(),
    upTo: z.string().datetime({ offset: true }).optional(),
  })
  .refine((value) => Boolean(value.ids?.length) || Boolean(value.upTo), {
    message: "Нужно передать ids или upTo",
  });

export const webappOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
