import { escapeHtml as e } from "@/lib/telegram/escape";

type TemplateData = Record<string, unknown>;
type TemplateFn = (d: TemplateData) => string;

// #471: все эти шаблоны в итоге уходят через telegramAdapter.send(), который
// всегда шлёт parse_mode:"HTML" (в т.ч. "клиентские" — комментарий "Plain
// text" в service.ts относится к формату шаблона, не к Telegram parse mode).
// Часть полей — гостевой ввод с публичных, неаутентифицированных путей
// (гостевое бронирование, заявка на офис, оформление кафе-заказа), поэтому
// каждое интерполируемое значение экранируется, а не выборочно по провенансу.

// Единые шаблоны онлайн-оплат (ЮKassa) — одинаковы для всех модулей,
// подмешиваются в каждый модульный блок ниже.
const paymentClientTemplates: Record<string, TemplateFn> = {
  "payment.succeeded": (d) =>
    `Оплата получена: ${e(d.amount)} ₽\n\n${e(d.description)}\n\nЧек придёт на указанный при оплате контакт.`,
  "payment.canceled": (d) =>
    `Оплата не прошла (${e(d.amount)} ₽).\n\n${e(d.description)}\n\nПопробуйте оформить заново или обратитесь к администратору.`,
  "payment.refund.succeeded": (d) =>
    `Возврат оформлен: ${e(d.amount)} ₽\n\n${e(d.description)}\n\nДеньги вернутся тем же способом, которым вы платили (обычно 1–3 дня).`,
};

const paymentAdminTemplates: Record<string, TemplateFn> = {
  "payment.succeeded": (d) =>
    `<b>💳 Онлайн-оплата: ${e(d.amount)} ₽</b>\n\n${e(d.description)}`,
  "payment.refund.succeeded": (d) =>
    `<b>↩️ Возврат: ${e(d.amount)} ₽</b>\n\n${e(d.description)}`,
};

/**
 * Client notification templates — sent to the user.
 * Organized by module slug, then event type.
 */
export const clientTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.created": (d) =>
      `Заявка принята!\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}\n\nОжидайте подтверждения.`,
    "booking.confirmed": (d) =>
      `Бронирование подтверждено!\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}`,
    "booking.cancelled": (d) =>
      `Бронирование отменено.\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}`,
    "booking.rescheduled": (d) =>
      `Бронирование перенесено.\n\n${e(d.resourceName)}\nБыло: ${e(d.oldDate)}, ${e(d.oldStartTime)} — ${e(d.oldEndTime)}\nСтало: ${e(d.date)}, ${e(d.startTime)} — ${e(d.endTime)}`,
    "booking.reminder": (d) =>
      `Напоминание: через 1 час начинается ваше бронирование.\n\n${e(d.resourceName)}\nВремя: ${e(d.startTime)}`,
    "booking.ending_soon": (d) =>
      `Ваша бронь заканчивается через 1 час (в ${e(d.endTime)}).\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\n\nХотите продлить? Свяжитесь с нами: +7 (499) 677-48-88.`,
    ...paymentClientTemplates,
  },
  "ps-park": {
    "booking.created": (d) =>
      `Заявка принята!\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}\n\nОжидайте подтверждения.`,
    "booking.confirmed": (d) =>
      `Бронирование подтверждено!\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}`,
    "booking.cancelled": (d) =>
      `Бронирование отменено.\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}`,
    "booking.reminder": (d) =>
      `Напоминание: через 1 час начинается ваше бронирование.\n\n${e(d.resourceName)}\nВремя: ${e(d.startTime)}`,
    ...paymentClientTemplates,
  },
  cafe: {
    "order.placed": (d) =>
      `Заказ #${e(d.orderNumber)} принят!\n\nСумма: ${e(d.totalAmount)} руб.${d.deliveryTo ? `\nДоставка в офис: ${e(d.deliveryTo)}` : ""}`,
    "order.preparing": (d) =>
      `Ваш заказ #${e(d.orderNumber)} готовится.`,
    "order.ready": (d) =>
      `Ваш заказ #${e(d.orderNumber)} готов! Заберите его.${d.deliveryTo ? `\nДоставка в офис: ${e(d.deliveryTo)}` : ""}`,
    "order.delivered": (d) =>
      `Заказ #${e(d.orderNumber)} доставлен. Приятного аппетита!`,
    "order.cancelled": (d) =>
      `Заказ #${e(d.orderNumber)} отменён.`,
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
      `<b>Новое бронирование!</b>\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}\nКлиент: ${e(d.userName)}\n\nТребуется подтверждение.`,
    "booking.cancelled": (d) =>
      `<b>Бронирование отменено</b>\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}\nКлиент: ${e(d.userName)}`,
    ...paymentAdminTemplates,
  },
  "ps-park": {
    "booking.created": (d) =>
      `<b>Новое бронирование!</b>\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}\nКлиент: ${e(d.userName)}\n\nТребуется подтверждение.`,
    "booking.cancelled": (d) =>
      `<b>Бронирование отменено</b>\n\n${e(d.resourceName)}\nДата: ${e(d.date)}\nВремя: ${e(d.startTime)} — ${e(d.endTime)}\nКлиент: ${e(d.userName)}`,
    ...paymentAdminTemplates,
  },
  cafe: {
    "order.placed": (d) =>
      `<b>Новый заказ #${e(d.orderNumber)}</b>\n\nКлиент: ${e(d.userName)}\nСумма: ${e(d.totalAmount)} руб.${d.deliveryTo ? `\nДоставка: офис ${e(d.deliveryTo)}` : ""}\nПозиций: ${e(d.itemCount)}`,
    "order.cancelled": (d) =>
      `<b>Заказ отменён #${e(d.orderNumber)}</b>\n\nКлиент: ${e(d.userName)}\nСумма: ${e(d.totalAmount)} руб.`,
    ...paymentAdminTemplates,
  },
  rental: {
    "contract.created": (d) =>
      `<b>Новый договор аренды</b>\n\nАрендатор: ${e(d.tenantName)}\nОфис: ${e(d.officeNumber)}\nСтавка: ${e(d.monthlyRate)} руб./мес.\nСрок: ${e(d.startDate)} — ${e(d.endDate)}`,
    "contract.expiring": (d) =>
      `<b>Договор истекает через ${e(d.daysLeft)} дн.</b>\n\nАрендатор: ${e(d.tenantName)}\nОфис: ${e(d.officeNumber)}\nДата окончания: ${e(d.endDate)}`,
    "inquiry.created": (d) =>
      `<b>Новая заявка на аренду!</b>\n\nИмя: ${e(d.name)}\nТелефон: ${e(d.phone)}\nEmail: ${e(d.email)}\nКомпания: ${e(d.companyName)}\nОфис: ${e(d.officeNumber)}\n\nСообщение: ${e(d.message)}`,
  },
  "rental-inquiry": {
    "inquiry.created": (d) =>
      `<b>🏢 Новая заявка на офис!</b>\n\nИмя: ${e(d.name)}\nТелефон: ${e(d.phone)}\nEmail: ${e(d.email)}\nКомпания: ${e(d.companyName)}\nОфис: ${e(d.officeNumber)}\n\nСообщение: ${e(d.message)}`,
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
