import { NotificationChannel } from "@prisma/client";

/**
 * A domain event that triggers notifications.
 */
export type NotificationEvent = {
  type: string; // "booking.confirmed", "order.ready", etc.
  moduleSlug: string; // "gazebos", "cafe", etc.
  entityId: string; // booking/order ID
  userId?: string; // client user ID (for client notifications)
  actor?: "client" | "admin";
  /**
   * Кому из персонала доставлять событие (по умолчанию — всем, как раньше):
   * - `personal` — только сотрудникам, лично подписавшимся в Центре
   *   уведомлений Mini App; общий админ-чат модуля, заменяющие его явные
   *   получатели, выделенный канал и всплывающие уведомления админки — нет;
   * - `none` — персоналу не доставляется вовсе, только клиенту.
   * Так бронь, которая ждёт онлайн-оплаты, не шумит у смены: о ней узнают,
   * когда она оплачена (см. gazebos createBooking, payments/subjects/booking).
   */
  staffAudience?: "personal" | "none";
  /** Event-specific payload for templates. */
  data: Record<string, unknown>;
};

/**
 * User with contact fields needed for channel resolution.
 */
export type UserWithContacts = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  telegramId: string | null;
  vkId: string | null;
};

/**
 * Per-module Telegram bot configuration stored in Module.config JSON.
 */
export type ModuleBotConfig = {
  telegramBotToken?: string;
  telegramAdminChatId?: string;
  /** Explicit `false` disables the admin group chat entirely — no chatId fallback. */
  telegramAdminChatEnabled?: boolean;
};

/**
 * Pluggable channel adapter interface.
 */
export interface ChannelAdapter {
  channel: NotificationChannel;
  send(
    recipient: string,
    message: string,
    options?: { botToken?: string }
  ): Promise<{ success: boolean; error?: string }>;
  /** Send with pre-rendered HTML (email only). Falls back to send() if not implemented. */
  sendHtml?(
    recipient: string,
    subject: string,
    html: string,
    text: string
  ): Promise<{ success: boolean; error?: string }>;
  resolveRecipient(user: UserWithContacts): string | null;
}

// === Delivery & reaction statistics (ADR 2026-10-25-team-access-notifications §6.2) ===

export type StatsDays = 7 | 30 | 90;

/** Same block of numbers for the totals and every slice row (AC-D1.3). */
export type NotificationMetrics = {
  /** Logical notifications: fallback chains + Mini App feed cards. */
  sent: number;
  delivered: number;
  failed: number;
  inFlight: number;
  /** Delivered and read in the Mini App feed («Прочитать всё» excluded). */
  read: number;
  clickedNotifications: number;
  clicksTotal: number;
  /** Delivered and reaction can be measured (feed card or a tracked button). */
  measurable: number;
  /** Delivered, but reaction can't be measured (e.g. Telegram without a button). */
  unmeasurable: number;
  reactions: number;
  /** reactions / measurable; null when nothing is measurable. */
  reactionRate: number | null;
  medianReactionSeconds: number | null;
  /** Share of measurable notifications delivered ≥ 24 h ago without a reaction within 24 h. */
  noReaction24hShare: number | null;
};

export type StatsPeriodInfo = { days: StatsDays; from: string; to: string };

export type StatsMeasuredSince = {
  /** When click/read tracking started; null — not measured yet. */
  clicks: string | null;
  /** The period starts before tracking started (AC-D1.8). */
  partial: boolean;
};

export type StatsSkips = {
  total: number;
  byReason: Array<{ reason: string; label: string; count: number }>;
};

export type StatsUserRef = { id: string; name: string | null; role: string };

export type StatsEventRow = { eventType: string; label: string; categoryKey: string } & NotificationMetrics;
export type StatsUserRow = { user: StatsUserRef } & NotificationMetrics;
export type StatsChannelRow = { channel: string } & NotificationMetrics;

export type NotificationStats = {
  period: StatsPeriodInfo;
  measuredSince: StatsMeasuredSince;
  totals: NotificationMetrics;
  byEvent: StatsEventRow[];
  byUser: StatsUserRow[];
  byChannel: StatsChannelRow[];
  skips: StatsSkips;
  /** Legacy group-chat journal (NotificationLog without a person) — AC-D1.5. */
  groupChats: { sent: number; failed: number };
  problems: {
    botNotStarted: { users: number; failedDeliveries: number; userIds: string[] };
    botBlocked: { users: number; failedDeliveries: number; userIds: string[] };
    noWorkingChannel: { users: number; userIds: string[] };
    eventsWithoutPersonalRecipients: { count: number; eventTypes: string[] };
  };
};

export type RecentDeliveryStatus = "DELIVERED" | "FAILED" | "IN_FLIGHT" | "SKIPPED";

/** One row of «Последние уведомления» — never the message text (AC-D2.2). */
export type RecentNotificationItem = {
  at: string;
  eventType: string;
  eventLabel: string;
  channel: string | null;
  status: RecentDeliveryStatus;
  statusLabel: string;
  /** Delivered and the reaction is measurable (otherwise «реакцию измерить нельзя»). */
  measurable: boolean;
  reaction: { kind: "read" | "click"; afterSeconds: number } | null;
};

export type UserNotificationStats = {
  period: StatsPeriodInfo;
  measuredSince: StatsMeasuredSince;
  totals: NotificationMetrics;
  byEvent: StatsEventRow[];
  byChannel: StatsChannelRow[];
  skips: StatsSkips;
  recent: RecentNotificationItem[];
  problems: {
    botNotStarted: boolean;
    botBlocked: boolean;
    /** Failed deliveries caused by the bot (not started + blocked). */
    failedByBot: number;
    failedBotNotStarted: number;
    failedBotBlocked: number;
  };
};
