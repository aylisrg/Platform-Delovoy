import { z } from "zod";

export const TELEPHONY_DAILY_EVENT = "telephony.daily_summary";
export const TELEPHONY_DAILY_HOUR_MSK = 9;

/** Persisted snapshot: only aggregates, never contact or employee data. */
export const telephonyDailySummarySchema = z.object({
  reportDate: z.iso.date(),
  timeZone: z.literal("Europe/Moscow"),
  generatedAt: z.iso.datetime(),
  total: z.number().int().nonnegative(),
  inbound: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  outbound: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  answerRate: z.number().min(0).max(100).nullable(),
}).refine((summary) => summary.total === summary.inbound + summary.outbound
  && summary.inbound === summary.answered + summary.missed + summary.pending,
{ message: "Inconsistent call summary counters" });

export type TelephonyDailySummary = z.infer<typeof telephonyDailySummarySchema>;

export type TelephonyDailyPayload = {
  title: string;
  body: string;
  telephonySummary: TelephonyDailySummary;
};
