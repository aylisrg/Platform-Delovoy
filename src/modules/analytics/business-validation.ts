import { z } from "zod";
import { businessDay } from "./business-dates";
export const businessQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("7d"),
  weekEnding: z.iso.date().optional(),
}).strict().refine(({ period, weekEnding }) => !weekEnding || (period === "7d" && new Date(`${weekEnding}T12:00:00Z`).getUTCDay() === 0 && weekEnding < businessDay(new Date())), "Неделя должна завершаться прошедшим воскресеньем");
export const businessPreferenceSchema = z.object({ enabled: z.boolean() }).strict();
export const businessTestSchema = z.object({ requestId: z.uuid() }).strict();
