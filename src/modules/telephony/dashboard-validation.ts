import { z } from "zod";

export const telephonyDashboardSchema = z.object({
  period: z.enum(["today", "7d", "30d"]).default("today"),
  filter: z.enum(["all", "inbound", "answered", "missed", "outbound"]).default("all"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

export type TelephonyDashboardQuery = z.infer<typeof telephonyDashboardSchema>;
