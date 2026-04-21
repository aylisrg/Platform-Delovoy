import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize HTML before it leaves the server.
 * Applied to:
 *  - preview endpoint (so iframe `sandbox=""` is defence-in-depth, not only line of defence);
 *  - custom HTML submitted via POST /api/rental/send-email (MANAGER-authored, trusted but not fully).
 *
 * Email-safe policy: keep typical inline markup, strip <script>/<iframe>/<object>/<embed>
 * and event handlers, disallow external resource loading via forbidden tags.
 */
const EMAIL_CONFIG = {
  ALLOWED_TAGS: [
    "a",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "p",
    "br",
    "div",
    "span",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "pre",
    "blockquote",
    "img",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "style", "width", "height", "target", "rel"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "style", "form", "input"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onfocus", "onmouseover"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|cid:|#)/i,
};

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, EMAIL_CONFIG) as unknown as string;
}
