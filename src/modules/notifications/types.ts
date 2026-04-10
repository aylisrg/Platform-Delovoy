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
  data: Record<string, unknown>; // event-specific payload for templates
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
  resolveRecipient(user: UserWithContacts): string | null;
}
