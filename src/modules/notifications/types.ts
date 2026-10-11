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
