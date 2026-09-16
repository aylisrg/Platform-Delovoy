import { z } from "zod";
import { FUNNEL_KEYS, FUNNELS, STEP_KEYS } from "./funnels";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const periodSchema = z.enum(["today", "7d", "30d"]);

export const analyticsQuerySchema = z
  .object({
    dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
    dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD").optional(),
    period: periodSchema.optional(),
    forceRefresh: z.preprocess(
      (val) => val === "true" || val === true,
      z.boolean().default(false)
    ),
  })
  .refine(
    (data) => {
      if (data.dateFrom && data.dateTo) {
        return data.dateFrom <= data.dateTo;
      }
      return true;
    },
    { message: "dateFrom не может быть позже dateTo" }
  )
  .refine(
    (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.dateTo && data.dateTo > today) return false;
      if (data.dateFrom && data.dateFrom > today) return false;
      return true;
    },
    { message: "Даты не могут быть в будущем" }
  );

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// --- ProductEvent (US-1 эпика #583, ADR 2026-09-16) ---

/**
 * Публичный ingest промежуточных шагов воронки (POST /api/analytics/events).
 * `.strict()` — лишние поля (в т.ч. попытка прислать metadata) отклоняются:
 * PII физически некуда просочиться (AC-1.5). Только шаги с
 * `clientRecordable: true` — серверные шаги (submitted/paid) через этот
 * эндпоинт принять нельзя, конверсию не подделать.
 */
export const productEventIngestSchema = z
  .object({
    funnel: z.enum(FUNNEL_KEYS),
    // Полный список ключей шагов (не только clientRecordable) — точное
    // ограничение "только клиентские шаги для этой воронки" даёт refine
    // ниже; так z.enum сохраняет литеральный union-тип для TS.
    step: z.enum(STEP_KEYS),
  })
  .strict()
  .refine(
    (data) => {
      const def = FUNNELS[data.funnel];
      return def?.steps.some((s) => s.step === data.step && s.clientRecordable) ?? false;
    },
    { message: "Шаг не принимается от клиента для этой воронки" }
  );

export type ProductEventIngestInput = z.infer<typeof productEventIngestSchema>;

/** Период для агрегации по воронке (AC-1.7) — не длиннее 180 дней, не в будущем. */
export const funnelStatsQuerySchema = z
  .object({
    funnel: z.enum(FUNNEL_KEYS).optional(),
    dateFrom: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
    dateTo: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
  })
  .refine((data) => data.dateFrom <= data.dateTo, {
    message: "dateFrom не может быть позже dateTo",
  })
  .refine(
    (data) => {
      const today = new Date().toISOString().slice(0, 10);
      return data.dateTo <= today;
    },
    { message: "dateTo не может быть в будущем" }
  )
  .refine(
    (data) => {
      const from = new Date(data.dateFrom).getTime();
      const to = new Date(data.dateTo).getTime();
      const days = (to - from) / 86_400_000;
      return days >= 0 && days <= 180;
    },
    { message: "Период не может превышать 180 дней" }
  );

export type FunnelStatsQuery = z.infer<typeof funnelStatsQuerySchema>;
