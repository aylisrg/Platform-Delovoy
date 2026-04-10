import { sendWhatsAppMessage } from "@/lib/green-api";
import type { ChannelAdapter, UserWithContacts } from "../types";

/**
 * WhatsApp channel adapter.
 * Uses Green API integration from lib/green-api.ts.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: "WHATSAPP",

  async send(recipient, message) {
    const result = await sendWhatsAppMessage(recipient, message);
    return {
      success: result.success,
      error: result.error,
    };
  },

  resolveRecipient(user: UserWithContacts) {
    return user.phone || null;
  },
};
