import { z } from "zod";
import { ROUTING_CATEGORY_KEYS } from "./routing-categories";

/** Which module slugs expose a dedicated broadcast channel (own bot token). */
export const MODULE_CHANNEL_SLUGS = ["gazebos", "ps-park"] as const;

/**
 * Body for `POST /api/admin/notifications/channel-test` — a manual test send.
 * `routing`        → per-category admin chat (resolved module → system → env).
 * `module-channel` → dedicated per-module broadcast channel (own bot token).
 */
export const channelTestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("routing"),
    key: z.enum(ROUTING_CATEGORY_KEYS),
  }),
  z.object({
    kind: z.literal("module-channel"),
    slug: z.enum(MODULE_CHANNEL_SLUGS),
  }),
]);

export type ChannelTestInput = z.infer<typeof channelTestSchema>;

export const updatePreferenceSchema = z.object({
  preferredChannel: z
    .enum(["AUTO", "TELEGRAM", "EMAIL", "VK"])
    .optional(),
  enableBooking: z.boolean().optional(),
  enableOrder: z.boolean().optional(),
  enableReminder: z.boolean().optional(),
});

export type UpdatePreferenceInput = z.infer<typeof updatePreferenceSchema>;

export const webappPreferenceSchema = z.object({
  preferredChannel: z
    .enum(["AUTO", "TELEGRAM", "EMAIL", "VK"])
    .optional(),
  enableBooking: z.boolean().optional(),
  enableOrder: z.boolean().optional(),
  enableReminder: z.boolean().optional(),
});

export type WebappPreferenceInput = z.infer<typeof webappPreferenceSchema>;

export const historyFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  moduleSlug: z.string().optional(),
  eventType: z.string().optional(),
});

export type HistoryFilter = z.infer<typeof historyFilterSchema>;
