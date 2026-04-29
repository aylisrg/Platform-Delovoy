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

export const AvitoReviewsQuerySchema = z.object({
  moduleSlug: z
    .union([z.enum(ATTACHED_MODULES), z.literal("none"), z.literal("all")])
    .optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  maxRating: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Inbound Messenger webhook payload (lenient — only the fields we use are
 * validated; the rest pass through `passthrough`).
 *
 * See ADR §2.6 and Avito Pro docs:
 *   POST /api/avito/webhook/messenger?token=<secret>
 */
export const AvitoMessengerWebhookSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
  timestamp: z.number().optional(),
  payload: z.object({
    type: z.literal("message"),
    value: z
      .object({
        id: z.string().min(1),
        chat_id: z.string().min(1),
        user_id: z.union([z.number(), z.string()]).optional(),
        author_id: z.union([z.number(), z.string()]),
        created: z.number(),
        type: z.string().optional(),
        content: z.object({ text: z.string().optional() }).passthrough(),
        item_id: z.union([z.number(), z.string()]).optional(),
      })
      .passthrough(),
  }),
});
