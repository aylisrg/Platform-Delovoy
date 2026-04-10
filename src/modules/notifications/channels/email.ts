import type { ChannelAdapter, UserWithContacts } from "../types";

/**
 * Email channel adapter.
 * Placeholder — logs to console. Ready for Resend/Mailgun integration.
 */
export const emailAdapter: ChannelAdapter = {
  channel: "EMAIL",

  async send(recipient, message) {
    // TODO: integrate with email service (Resend, Mailgun, etc.)
    console.log(`[Email] To: ${recipient} | ${message}`);
    return { success: true };
  },

  resolveRecipient(user: UserWithContacts) {
    return user.email || null;
  },
};
