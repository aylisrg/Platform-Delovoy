import { z } from "zod";

export const SEGMENT_KEYS = [
  "active_office_tenants",
  "ps_park_guests_90d",
  "gazebo_guests_180d",
  "all_verified_users",
] as const;

export const broadcastSchema = z.object({
  segmentKey: z.enum(SEGMENT_KEYS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z.string().url().optional(),
});

export type BroadcastInput = z.infer<typeof broadcastSchema>;
