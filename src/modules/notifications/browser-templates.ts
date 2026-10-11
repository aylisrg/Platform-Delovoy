/**
 * Browser notification templates for admin events.
 * Returns { title, body } for the Browser Notification API.
 */

import { formatRub, formatSlot, pluralDays } from "./text-format";

type TemplateData = Record<string, unknown>;
type BrowserTemplate = { title: string; body: string };
type BrowserTemplateFn = (d: TemplateData) => BrowserTemplate;

const bookingBody = (d: TemplateData) => `${d.resourceName} · ${formatSlot(d)}`;

/** Заголовок новой брони говорит, нужно ли что-то делать (см. templates.ts). */
function bookingCreated(park: string): BrowserTemplateFn {
  return (d) => ({
    title:
      d.paymentFlow === "link"
        ? `${park}: новая бронь — ждёт оплаты`
        : `${park}: новая бронь — нужно подтвердить`,
    body: bookingBody(d),
  });
}

function bookingCancelled(park: string): BrowserTemplateFn {
  return (d) => ({ title: `${park}: бронь отменена`, body: bookingBody(d) });
}

const templates: Record<string, Record<string, BrowserTemplateFn>> = {
  gazebos: {
    "booking.created": bookingCreated("Барбекю Парк"),
    "booking.cancelled": bookingCancelled("Барбекю Парк"),
  },
  "ps-park": {
    "booking.created": bookingCreated("Плей Парк"),
    "booking.cancelled": bookingCancelled("Плей Парк"),
  },
  cafe: {
    "order.placed": (d) => ({
      title: "Кафе: новый заказ",
      body: `Заказ #${d.orderNumber} · ${formatRub(d.totalAmount)} ₽ · ${d.deliveryTo ? `в офис ${d.deliveryTo}` : "самовывоз"}`,
    }),
    "order.cancelled": (d) => ({
      title: "Кафе: заказ отменён",
      body: `Заказ #${d.orderNumber} · ${formatRub(d.totalAmount)} ₽`,
    }),
  },
  rental: {
    "contract.expiring": (d) => ({
      title: "Договор аренды заканчивается",
      body: `${d.tenantName}, офис ${d.officeNumber} — через ${pluralDays(Number(d.daysLeft))}`,
    }),
    "inquiry.created": (d) => ({
      title: "Новая заявка на аренду офиса",
      body: `${d.name}, ${d.phone}${d.officeNumber ? ` — офис ${d.officeNumber}` : ""}`,
    }),
  },
};

/**
 * Get browser notification title/body for an admin event.
 */
export function renderBrowserNotification(
  moduleSlug: string,
  eventType: string,
  data: TemplateData
): BrowserTemplate | null {
  const template = templates[moduleSlug]?.[eventType];
  if (!template) return null;
  return template(data);
}
