import { z } from "zod";

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
