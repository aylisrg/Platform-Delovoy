import type { ChannelAdapter, UserWithContacts } from "../types";
import nodemailer from "nodemailer";

let transporterInstance: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  if (!transporterInstance) {
    transporterInstance = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.yandex.ru",
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return transporterInstance;
}

export type TransactionalEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
};

/**
 * Send a transactional email (magic links, verification, etc.)
 * Falls back to console.log when SMTP_USER / SMTP_PASS are not configured.
 */
export async function sendTransactionalEmail(
  params: TransactionalEmailParams
): Promise<{ success: boolean; error?: string }> {
  const transporter = getTransporter();
  const defaultFrom =
    process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@delovoy-park.ru";
  const fromAddress = params.from || defaultFrom;
  const from = params.fromName
    ? `"${params.fromName.replace(/"/g, "'")}" <${fromAddress}>`
    : fromAddress;

  if (!transporter) {
    console.log(
      "[Email] (no SMTP credentials) From:",
      from,
      "To:",
      params.to,
      "Subject:",
      params.subject
    );
    console.log("[Email] HTML:", params.html);
    return { success: true };
  }

  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
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
 * Falls back to console.log when SMTP credentials are not configured.
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
