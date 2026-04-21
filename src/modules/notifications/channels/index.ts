import { NotificationChannel } from "@prisma/client";
import type { ChannelAdapter, UserWithContacts } from "../types";
import { telegramAdapter } from "./telegram";
import { emailAdapter } from "./email";
import { vkAdapter } from "./vk";

const adapters: Record<string, ChannelAdapter> = {
  TELEGRAM: telegramAdapter,
  EMAIL: emailAdapter,
  VK: vkAdapter,
};

/**
 * Get a channel adapter by channel type.
 */
export function getAdapter(
  channel: NotificationChannel
): ChannelAdapter | null {
  if (channel === "AUTO") return null;
  return adapters[channel] || null;
}

/**
 * Resolve which channel to use for a user.
 * Priority: Telegram > WhatsApp > Email > VK
 *
 * If preferredChannel is set (not AUTO), uses that.
 * Otherwise resolves from available contact info.
 */
export function resolveChannelForUser(
  user: UserWithContacts,
  preferredChannel: NotificationChannel = "AUTO"
): { channel: NotificationChannel; recipient: string } | null {
  // Explicit preference
  if (preferredChannel !== "AUTO") {
    const adapter = adapters[preferredChannel];
    if (adapter) {
      const recipient = adapter.resolveRecipient(user);
      if (recipient) {
        return { channel: preferredChannel, recipient };
      }
    }
    // Preferred channel not available for this user — fall through to AUTO
  }

  // AUTO: priority order
  const priority: NotificationChannel[] = [
    "TELEGRAM",
    "EMAIL",
    "VK",
  ];

  for (const ch of priority) {
    const adapter = adapters[ch];
    const recipient = adapter.resolveRecipient(user);
    if (recipient) {
      return { channel: ch, recipient };
    }
  }

  return null;
}
