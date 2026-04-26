import type { NotificationChannelKind } from "@prisma/client";
import type {
  DeliveryResult,
  INotificationChannel,
  NotificationPayload,
} from "../types";
import { sendTransactionalEmail } from "../../channels/email";

/**
 * Channel-agnostic Email channel — wraps existing nodemailer/Yandex SMTP adapter.
 */
export class EmailChannel implements INotificationChannel {
  readonly kind: NotificationChannelKind = "EMAIL";

  isAvailable(): boolean {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  async send(address: string, payload: NotificationPayload): Promise<DeliveryResult> {
    const html = renderHtml(payload);
    const text = renderText(payload);
    const res = await sendTransactionalEmail({
      to: address,
      subject: payload.title,
      html,
      text,
    });
    if (res.success) return { ok: true };
    return { ok: false, reason: res.error ?? "send failed", retryable: true };
  }
}

function renderText(p: NotificationPayload): string {
  let out = `${p.title}\n\n${p.body}`;
  if (p.actions?.length) {
    out += "\n\n";
    for (const a of p.actions) {
      out += `${a.label}: ${a.url ?? "(no link)"}\n`;
    }
  }
  return out;
}

function renderHtml(p: NotificationPayload): string {
  const safeBody = escape(p.body).replace(/\n/g, "<br/>");
  const actions = (p.actions ?? [])
    .filter((a) => a.url)
    .map(
      (a) =>
        `<p><a href="${escape(a.url!)}" style="display:inline-block;padding:10px 16px;background:#0EA5E9;color:#fff;text-decoration:none;border-radius:6px">${escape(
          a.label
        )}</a></p>`
    )
    .join("");
  return `<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:600px;margin:24px auto"><h2 style="margin:0 0 16px">${escape(
    p.title
  )}</h2><div style="line-height:1.5">${safeBody}</div>${actions}</body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
