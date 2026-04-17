import type { ChannelAdapter, UserWithContacts } from "../types";

let resendClient: import("resend").Resend | null = null;

function getResend(): import("resend").Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resendClient) {
    // Dynamic require to avoid import issues in test/edge environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resend } = require("resend") as typeof import("resend");
    resendClient = new Resend(key);
  }
  return resendClient;
}

export type TransactionalEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Send a transactional email (magic links, verification, etc.)
 * Falls back to console.log when RESEND_API_KEY is not configured.
 */
export async function sendTransactionalEmail(
  params: TransactionalEmailParams
): Promise<{ success: boolean; error?: string }> {
  const client = getResend();
  const from =
    process.env.RESEND_FROM_EMAIL || "noreply@delovoy-park.ru";

  if (!client) {
    console.log("[Email] (no RESEND_API_KEY) To:", params.to, "Subject:", params.subject);
    console.log("[Email] HTML:", params.html);
    return { success: true };
  }

  try {
    const { error } = await client.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      console.error("[Email] Resend error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Email] Send failed:", message);
    return { success: false, error: message };
  }
}

/**
 * Email channel adapter for the notifications system.
 * Used for booking confirmations, order updates, etc.
 * Falls back to console.log when RESEND_API_KEY is not configured.
 */
export const emailAdapter: ChannelAdapter = {
  channel: "EMAIL",

  async send(recipient, message) {
    return sendTransactionalEmail({
      to: recipient,
      subject: "Деловой Парк — уведомление",
      html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
      text: message,
    });
  },

  async sendHtml(recipient, subject, html, text) {
    return sendTransactionalEmail({ to: recipient, subject, html, text });
  },

  resolveRecipient(user: UserWithContacts) {
    return user.email || null;
  },
};
