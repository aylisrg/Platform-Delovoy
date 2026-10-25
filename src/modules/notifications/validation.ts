import { z } from "zod";
import { ROUTING_CATEGORY_KEYS } from "./routing-categories";
import { MANAGED_EVENT_TYPES, NOTIFICATION_CATALOG } from "./catalog";
import { STATS_CHANNELS } from "./delivery-labels";

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

/**
 * Body for `PATCH /api/admin/notifications/channel-test` — edit a dedicated
 * module channel's master switch and/or enabled event list directly from the
 * monitoring page, without going through the module-specific settings page.
 */
export const moduleChannelUpdateSchema = z.object({
  slug: z.enum(MODULE_CHANNEL_SLUGS),
  telegramChannelEnabled: z.boolean().optional(),
  telegramChannelEvents: z.array(z.string()).optional(),
});

export type ModuleChannelUpdateInput = z.infer<typeof moduleChannelUpdateSchema>;

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

/**
 * Body для `PUT /api/webapp/notification-center` — переключение одного типа
 * уведомления сотрудником.
 *
 * `eventType` — закрытый enum по каталогу Центра: записать предпочтение по
 * неуправляемому типу (в том числе по угаданному имени инфраструктурного
 * алерта) через Mini App невозможно в принципе — второй слой защиты AC-5.7.
 */
export const notificationCenterUpdateSchema = z.object({
  eventType: z.enum(MANAGED_EVENT_TYPES),
  enabled: z.boolean(),
});

export type NotificationCenterUpdateInput = z.infer<
  typeof notificationCenterUpdateSchema
>;

// === Delivery & reaction statistics (ADR 2026-10-25-team-access-notifications §6.2) ===

export const STATS_PERIOD_DAYS = [7, 30, 90] as const;
const STATS_CATEGORY_KEYS = NOTIFICATION_CATALOG.map((c) => c.key) as [string, ...string[]];

/** `?period=7|30|90`, default 30 — anything else (incl. "", "abc", 14) → 422. */
const STATS_PERIOD_ERROR = "Период — 7, 30 или 90 дней";
const statsPeriodField = z.coerce
  .number({ error: STATS_PERIOD_ERROR })
  .pipe(z.literal(STATS_PERIOD_DAYS, { error: STATS_PERIOD_ERROR }))
  .default(30);

/** `GET /api/users/[id]/notification-stats`. */
export const statsPeriodSchema = z.object({ period: statsPeriodField });

export type StatsPeriodQuery = z.infer<typeof statsPeriodSchema>;

/** `GET /api/admin/notifications/stats` — period + optional slices. */
export const notificationStatsQuerySchema = z.object({
  period: statsPeriodField,
  eventType: z.enum(MANAGED_EVENT_TYPES).optional(),
  category: z.enum(STATS_CATEGORY_KEYS).optional(),
  userId: z.string().min(1).max(64).optional(),
  channel: z.enum(STATS_CHANNELS).optional(),
});

export type NotificationStatsQuery = z.infer<typeof notificationStatsQuerySchema>;

export const historyFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  moduleSlug: z.string().optional(),
  eventType: z.string().optional(),
});

export type HistoryFilter = z.infer<typeof historyFilterSchema>;

/** GET /api/admin/notifications/matrix — team × events (US-C4, ADR 2026-10-25 §6.2). */
export const notificationMatrixQuerySchema = z.object({
  category: z.string().max(40).optional(),
  role: z.enum(["SUPERADMIN", "ADMIN", "MANAGER"]).optional(),
  problems: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").optional(),
});

export type NotificationMatrixQuery = z.infer<typeof notificationMatrixQuerySchema>;
