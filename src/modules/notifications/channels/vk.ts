import type { ChannelAdapter, UserWithContacts } from "../types";

/**
 * VK (Max) messenger channel adapter.
 * Placeholder — logs to console. Ready for VK Community Bot API integration.
 *
 * When implemented, will use VK API messages.send with community token:
 * POST https://api.vk.com/method/messages.send
 */
export const vkAdapter: ChannelAdapter = {
  channel: "VK",

  async send(recipient, message) {
    // TODO: integrate with VK Community Bot API
    console.log(`[VK] To: ${recipient} | ${message}`);
    return { success: true };
  },

  resolveRecipient(user: UserWithContacts) {
    return user.vkId || null;
  },
};
