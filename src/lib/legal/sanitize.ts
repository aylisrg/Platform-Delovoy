import DOMPurify from "isomorphic-dompurify";

/**
 * Санитизация HTML юридических документов перед dangerouslySetInnerHTML.
 *
 * parse-document уже экранирует исходный markdown, но текст редакций
 * редактируется в админке и хранится в БД: санитизация на рендере — вторая
 * линия защиты от XSS, если парсер или данные когда-нибудь пропустят разметку.
 * Разрешено только то, что реально выдаёт renderInline: ссылки, жирный,
 * курсив, переносы строк.
 */
const LEGAL_CONFIG = {
  ALLOWED_TAGS: ["a", "strong", "b", "em", "i", "br", "span", "code"],
  ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
};

export function sanitizeLegalHtml(html: string): string {
  return DOMPurify.sanitize(html, LEGAL_CONFIG) as unknown as string;
}
