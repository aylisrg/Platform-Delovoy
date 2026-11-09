import { z } from "zod";
import { businessDay, rangeDays } from "./business-dates";
import { BUSINESS_GRANULARITIES, BUSINESS_MAX_RANGE_DAYS, BUSINESS_PERIODS } from "./business-types";
export const businessQuerySchema = z.object({
  period: z.enum([...BUSINESS_PERIODS, "custom"] as const).default("7d"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  weekEnding: z.iso.date().optional(),
  granularity: z.enum(BUSINESS_GRANULARITIES).optional(),
}).strict()
  .refine(({ period, weekEnding }) => !weekEnding || (period === "7d" && new Date(`${weekEnding}T12:00:00Z`).getUTCDay() === 0 && weekEnding < businessDay(new Date())), "Неделя должна завершаться прошедшим воскресеньем")
  .refine(({ period, from, to }) => period === "custom" ? Boolean(from && to) : !from && !to, "Даты задаются только для своего периода")
  .refine(({ period, from, to }) => period !== "custom" || !from || !to || (from <= to && to < businessDay(new Date())), "Период должен закончиться не позже вчерашнего дня")
  .refine(({ period, from, to }) => period !== "custom" || !from || !to || rangeDays(from, to) <= BUSINESS_MAX_RANGE_DAYS, `Период не длиннее ${BUSINESS_MAX_RANGE_DAYS} дней`);
export type BusinessQuery = z.infer<typeof businessQuerySchema>;
export const businessPreferenceSchema = z.object({ enabled: z.boolean() }).strict();
export const businessTestSchema = z.object({ requestId: z.uuid() }).strict();
