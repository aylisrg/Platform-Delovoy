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
   * Event-specific payload for templates.
   *
   * Служебный ключ `adminChat: false` — событие только для сотрудников, лично
   * подписавшихся в Центре уведомлений Mini App. Его не получают общий
   * админ-чат модуля, заменяющие его явные получатели, выделенный канал и
   * всплывающие уведомления админки. Так помечается, например, бронь, которая
   * ещё ждёт онлайн-оплаты: смене по ней делать нечего, а о самой оплате чат
   * узнает из `payment.succeeded`.
   */
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
