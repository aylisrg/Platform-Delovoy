import { z } from "zod";
import { ATTACHED_MODULES, AVITO_STATS_PERIODS } from "./types";

export const AvitoItemAssignSchema = z.object({
  moduleSlug: z.enum(ATTACHED_MODULES).nullable(),
});

export const AvitoStatsQuerySchema = z.object({
  period: z.enum(AVITO_STATS_PERIODS).default("7d"),
});

export const AvitoItemsQuerySchema = z.object({
  moduleSlug: z.union([z.enum(ATTACHED_MODULES), z.literal("none"), z.literal("all")]).optional(),
  period: z.enum(AVITO_STATS_PERIODS).default("7d"),
});

export const AvitoReplySchema = z.object({
  text: z.string().min(1).max(2000),
});
