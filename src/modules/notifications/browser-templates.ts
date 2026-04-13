/**
 * Browser notification templates for admin events.
 * Returns { title, body } for the Browser Notification API.
 */

type TemplateData = Record<string, unknown>;
type BrowserTemplate = { title: string; body: string };
type BrowserTemplateFn = (d: TemplateData) => BrowserTemplate;

const templates: Record<string, Record<string, BrowserTemplateFn>> = {
  gazebos: {
    "booking.created": (d) => ({
      title: "Новое бронирование — Барбекю Парк",
      body: `${d.resourceName}\n${d.date} ${d.startTime}–${d.endTime}`,
    }),
    "booking.cancelled": (d) => ({
      title: "Бронирование отменено — Барбекю Парк",
      body: `${d.resourceName}\n${d.date} ${d.startTime}–${d.endTime}`,
    }),
  },
  "ps-park": {
    "booking.created": (d) => ({
      title: "Новое бронирование — Плей Парк",
      body: `${d.resourceName}\n${d.date} ${d.startTime}–${d.endTime}`,
    }),
    "booking.cancelled": (d) => ({
      title: "Бронирование отменено — Плей Парк",
      body: `${d.resourceName}\n${d.date} ${d.startTime}–${d.endTime}`,
    }),
  },
  cafe: {
    "order.placed": (d) => ({
      title: "Новый заказ — Кафе",
      body: `Заказ #${d.orderNumber}, ${d.totalAmount} руб.${d.deliveryTo ? ` → офис ${d.deliveryTo}` : ""}`,
    }),
    "order.cancelled": (d) => ({
      title: "Заказ отменён — Кафе",
      body: `Заказ #${d.orderNumber}, ${d.totalAmount} руб.`,
    }),
  },
  rental: {
    "contract.expiring": (d) => ({
      title: "Договор истекает",
      body: `${d.tenantName}, офис ${d.officeNumber} — через ${d.daysLeft} дн.`,
    }),
    "inquiry.created": (d) => ({
      title: "Новая заявка на аренду",
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
