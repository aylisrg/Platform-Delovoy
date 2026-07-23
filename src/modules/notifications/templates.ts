type TemplateData = Record<string, unknown>;
type TemplateFn = (d: TemplateData) => string;

// Единые шаблоны онлайн-оплат (ЮKassa) — одинаковы для всех модулей,
// подмешиваются в каждый модульный блок ниже.
const paymentClientTemplates: Record<string, TemplateFn> = {
  "payment.succeeded": (d) =>
    `Оплата получена: ${d.amount} ₽\n\n${d.description}\n\nЧек придёт на указанный при оплате контакт.`,
  "payment.canceled": (d) =>
    `Оплата не прошла (${d.amount} ₽).\n\n${d.description}\n\nПопробуйте оформить заново или обратитесь к администратору.`,
  "payment.refund.succeeded": (d) =>
    `Возврат оформлен: ${d.amount} ₽\n\n${d.description}\n\nДеньги вернутся тем же способом, которым вы платили (обычно 1–3 дня).`,
};

const paymentAdminTemplates: Record<string, TemplateFn> = {
  "payment.succeeded": (d) =>
    `<b>💳 Онлайн-оплата: ${d.amount} ₽</b>\n\n${d.description}`,
  "payment.refund.succeeded": (d) =>
    `<b>↩️ Возврат: ${d.amount} ₽</b>\n\n${d.description}`,
};

/**
 * Client notification templates — sent to the user.
 * Organized by module slug, then event type.
 */
export const clientTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.created": (d) =>
      `Заявка принята!\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}\n\nОжидайте подтверждения.`,
    "booking.confirmed": (d) =>
      `Бронирование подтверждено!\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.cancelled": (d) =>
      `Бронирование отменено.\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.reminder": (d) =>
      `Напоминание: через 1 час начинается ваше бронирование.\n\n${d.resourceName}\nВремя: ${d.startTime}`,
    ...paymentClientTemplates,
  },
  "ps-park": {
    "booking.created": (d) =>
      `Заявка принята!\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}\n\nОжидайте подтверждения.`,
    "booking.confirmed": (d) =>
      `Бронирование подтверждено!\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.cancelled": (d) =>
      `Бронирование отменено.\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.reminder": (d) =>
      `Напоминание: через 1 час начинается ваше бронирование.\n\n${d.resourceName}\nВремя: ${d.startTime}`,
    ...paymentClientTemplates,
  },
  cafe: {
    "order.placed": (d) =>
      `Заказ #${d.orderNumber} принят!\n\nСумма: ${d.totalAmount} руб.${d.deliveryTo ? `\nДоставка в офис: ${d.deliveryTo}` : ""}`,
    "order.preparing": (d) =>
      `Ваш заказ #${d.orderNumber} готовится.`,
    "order.ready": (d) =>
      `Ваш заказ #${d.orderNumber} готов! Заберите его.${d.deliveryTo ? `\nДоставка в офис: ${d.deliveryTo}` : ""}`,
    "order.delivered": (d) =>
      `Заказ #${d.orderNumber} доставлен. Приятного аппетита!`,
    "order.cancelled": (d) =>
      `Заказ #${d.orderNumber} отменён.`,
    ...paymentClientTemplates,
  },
};

/**
 * Admin notification templates — sent to module admin group.
 * These use HTML formatting for Telegram.
 */
export const adminTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.created": (d) =>
      `<b>Новое бронирование!</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}\nКлиент: ${d.userName}\n\nТребуется подтверждение.`,
    "booking.cancelled": (d) =>
      `<b>Бронирование отменено</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}\nКлиент: ${d.userName}`,
    ...paymentAdminTemplates,
  },
  "ps-park": {
    "booking.created": (d) =>
      `<b>Новое бронирование!</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}\nКлиент: ${d.userName}\n\nТребуется подтверждение.`,
    "booking.cancelled": (d) =>
      `<b>Бронирование отменено</b>\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}\nКлиент: ${d.userName}`,
    ...paymentAdminTemplates,
  },
  cafe: {
    "order.placed": (d) =>
      `<b>Новый заказ #${d.orderNumber}</b>\n\nКлиент: ${d.userName}\nСумма: ${d.totalAmount} руб.${d.deliveryTo ? `\nДоставка: офис ${d.deliveryTo}` : ""}\nПозиций: ${d.itemCount}`,
    "order.cancelled": (d) =>
      `<b>Заказ отменён #${d.orderNumber}</b>\n\nКлиент: ${d.userName}\nСумма: ${d.totalAmount} руб.`,
    ...paymentAdminTemplates,
  },
  rental: {
    "contract.created": (d) =>
      `<b>Новый договор аренды</b>\n\nАрендатор: ${d.tenantName}\nОфис: ${d.officeNumber}\nСтавка: ${d.monthlyRate} руб./мес.\nСрок: ${d.startDate} — ${d.endDate}`,
    "contract.expiring": (d) =>
      `<b>Договор истекает через ${d.daysLeft} дн.</b>\n\nАрендатор: ${d.tenantName}\nОфис: ${d.officeNumber}\nДата окончания: ${d.endDate}`,
    "inquiry.created": (d) =>
      `<b>Новая заявка на аренду!</b>\n\nИмя: ${d.name}\nТелефон: ${d.phone}\nEmail: ${d.email}\nКомпания: ${d.companyName}\nОфис: ${d.officeNumber}\n\nСообщение: ${d.message}`,
  },
  "rental-inquiry": {
    "inquiry.created": (d) =>
      `<b>🏢 Новая заявка на офис!</b>\n\nИмя: ${d.name}\nТелефон: ${d.phone}\nEmail: ${d.email}\nКомпания: ${d.companyName}\nОфис: ${d.officeNumber}\n\nСообщение: ${d.message}`,
  },
};

/**
 * Render a client template for the given module and event.
 */
export function renderClientMessage(
  moduleSlug: string,
  eventType: string,
  data: TemplateData
): string | null {
  const template = clientTemplates[moduleSlug]?.[eventType];
  if (!template) return null;
  return template(data);
}

/**
 * Render an admin template for the given module and event.
 */
export function renderAdminMessage(
  moduleSlug: string,
  eventType: string,
  data: TemplateData
): string | null {
  const template = adminTemplates[moduleSlug]?.[eventType];
  if (!template) return null;
  return template(data);
}
