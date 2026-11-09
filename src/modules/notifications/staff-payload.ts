import type { NotificationPayload } from "./dispatch/types";

/**
 * Admin templates are Telegram HTML written for the group chat. A personal
 * message goes through `dispatch()`, whose channels (Telegram, Mini App feed,
 * Web Push, email) take plain `title`/`body` and escape it themselves — so the
 * raw HTML used to arrive as literal `<b>…</b>` and `<a href=…>` text with a
 * technical title like «[gazebos] booking created».
 *
 * Here the HTML becomes a plain payload: the first line is the title, links
 * become buttons (actions; tracked `/r/` links are added by the dispatcher).
 */

const LINK_RE = /<a\s+href="([^"]+)"\s*>([^<]*)<\/a>/gi;
const TAG_RE = /<\/?[a-z][^>]*>/gi;
const MAX_ACTIONS = 3;

function unescape(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

export function htmlToStaffPayload(html: string, fallbackTitle: string): NotificationPayload {
  const actions: NonNullable<NotificationPayload["actions"]> = [];
  const withoutLinks = html.replace(LINK_RE, (_, url: string, label: string) => {
    const href = unescape(url);
    if (actions.length < MAX_ACTIONS && /^https?:\/\//.test(href)) {
      actions.push({ label: unescape(label).trim() || "Открыть", url: href });
    }
    return "";
  });
  const text = unescape(withoutLinks.replace(TAG_RE, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const [first, ...rest] = text.split("\n");
  const title = first?.trim() || fallbackTitle;
  const body = rest.join("\n").trim();
  return { title, body, ...(actions.length ? { actions } : {}) };
}
