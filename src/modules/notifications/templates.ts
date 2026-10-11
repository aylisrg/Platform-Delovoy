import { escapeHtml as e } from "@/lib/telegram/escape";
import {
  PARK_PHONE,
  adminBookingLink,
  formatClient,
  formatEventDate,
  formatRub,
  formatSlot,
  humanizeDates,
  pluralDays,
} from "./text-format";

type TemplateData = Record<string, unknown>;
type TemplateFn = (d: TemplateData) => string;

// #471: все эти шаблоны в итоге уходят через telegramAdapter.send(), который
// всегда шлёт parse_mode:"HTML" (в т.ч. "клиентские" — комментарий "Plain
// text" в service.ts относится к формату шаблона, не к Telegram parse mode).
// Часть полей — гостевой ввод с публичных, неаутентифицированных путей
// (гостевое бронирование, заявка на офис, оформление кафе-заказа), поэтому
// каждое интерполируемое значение экранируется, а не выборочно по провенансу.
//
// Правило текстов: заголовок говорит, что случилось, последняя строка — что
// с этим делать (или что делать ничего не нужно). Пустые поля не печатаются:
// «Клиент:» без имени хуже, чем отсутствие строки.

/** Ресурс и слот для клиента: «Беседка №3\nсб, 10 октября · 16:00–22:00». */
const slotLines = (d: TemplateData) => `${e(d.resourceName)}\n${e(formatSlot(d))}`;

/** Ресурс, слот и клиент для админ-чата (клиент — только если известен). */
function adminBookingBlock(d: TemplateData): string {
  const lines = [e(d.resourceName), `📅 ${e(formatSlot(d))}`];
  const client = formatClient(d);
  if (client) lines.push(`👤 ${e(client)}`);
  return lines.join("\n");
}

const orderNo = (d: TemplateData) => `#${e(d.orderNumber)}`;

// ── Клиентские тексты бронирований ─────────────────────────────────────────

/**
 * Бронь создана. Что ждёт клиента дальше, зависит от того, как бронь будет
 * подтверждена (`paymentFlow`, проставляет gazebos/service.ts createBooking):
 * - online — клиент ушёл на оплату ЮKassa, подтверждение придёт само;
 * - link   — бронь из бота/Mini App, оплатить можно по ссылке на страницу брони;
 * - иначе  — подтверждает администратор (ps-park всегда, беседки без онлайн-оплаты).
 */
function clientBookingCreated(d: TemplateData): string {
  if (d.paymentFlow === "online") {
    return `Бронь создана — осталось оплатить\n\n${slotLines(d)}\n\nОплатите бронь в течение часа: после оплаты она подтвердится автоматически. Если не оплатить, бронь отменится и время освободится.`;
  }
  if (d.paymentFlow === "link") {
    return `Бронь создана, но ещё не оплачена\n\n${slotLines(d)}\n\nОплатить можно по ссылке, которую вы получили при бронировании, — после оплаты бронь подтвердится автоматически. Вопросы: ${PARK_PHONE}.`;
  }
  return `Заявка на бронь принята\n\n${slotLines(d)}\n\nАдминистратор проверит время и подтвердит бронь — мы пришлём сообщение. Вопросы: ${PARK_PHONE}.`;
}

const clientBookingConfirmed: TemplateFn = (d) =>
  `Бронь подтверждена ✅\n\n${slotLines(d)}\n\nЖдём вас! Если планы изменятся, позвоните: ${PARK_PHONE}.`;

const clientBookingCancelled: TemplateFn = (d) =>
  d.cancelledBecause === "unpaid"
    ? `Бронь отменена: оплата не поступила\n\n${slotLines(d)}\n\nВремя снова свободно — забронировать заново можно на сайте.`
    : `Бронь отменена\n\n${slotLines(d)}\n\nЕсли вы её не отменяли или есть вопросы, позвоните: ${PARK_PHONE}.`;

const clientBookingRescheduled: TemplateFn = (d) => {
  const was = formatSlot({ date: d.oldDate, startTime: d.oldStartTime, endTime: d.oldEndTime });
  return `Бронь перенесена\n\n${e(d.resourceName)}\nБыло: ${e(was)}\nСтало: ${e(formatSlot(d))}\n\nЕсли время не подходит, позвоните: ${PARK_PHONE}.`;
};

const clientBookingReminder: TemplateFn = (d) =>
  `Через час начинается ваша бронь\n\n${slotLines(d)}\n\nЖдём вас!`;

const clientBookingEndingSoon: TemplateFn = (d) =>
  `Ваша бронь закончится через час, в ${e(d.endTime)}\n\n${e(d.resourceName)} · ${e(formatEventDate(d.date))}\n\nХотите остаться подольше? Позвоните: ${PARK_PHONE} — продлим, если время свободно.`;

// Единые шаблоны онлайн-оплат (ЮKassa) — одинаковы для всех модулей,
// подмешиваются в каждый модульный блок ниже. Описание платежа — это же
// описание у ЮKassa и в чеке («Беседка: №3, 2026-10-10 16:00–22:00»), поэтому
// оно не меняется, а дата в нём переписывается только для показа.
function paymentClientTemplates(moduleSlug: string): Record<string, TemplateFn> {
  // Отмена платежа отменяет и то, за что платили (бронь беседки, заказ кафе,
  // абонемент) — повторить ту же оплату нельзя, только оформить заново. Счёт
  // по брони PS Park при этом остаётся, его можно оплатить ещё раз.
  const afterCancel = (d: TemplateData) => {
    if (moduleSlug === "ps-park" && d.subjectType === "BOOKING") {
      return `Счёт можно оплатить ещё раз или на месте. Вопросы: ${PARK_PHONE}.`;
    }
    const what = moduleSlug === "gazebos" ? "бронь " : moduleSlug === "cafe" ? "заказ " : "";
    return `Чтобы попробовать снова, оформите ${what}заново. Вопросы: ${PARK_PHONE}.`;
  };
  return {
    "payment.succeeded": (d) =>
      `Оплата прошла: ${e(d.amount)} ₽\n\n${e(humanizeDates(d.description))}\n\nЧек придёт на почту или телефон, указанные при оплате.`,
    "payment.canceled": (d) =>
      `Оплата не прошла: ${e(d.amount)} ₽\n\n${e(humanizeDates(d.description))}\n\nДеньги не списаны. ${afterCancel(d)}`,
    "payment.refund.succeeded": (d) =>
      `Возврат оформлен: ${e(d.amount)} ₽\n\n${e(humanizeDates(d.description))}\n\nДеньги вернутся тем же способом, которым вы платили, — обычно за 1–3 дня (срок зависит от банка).`,
  };
}

/**
 * Client notification templates — sent to the user.
 * Organized by module slug, then event type.
 */
export const clientTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.created": clientBookingCreated,
    "booking.confirmed": clientBookingConfirmed,
    "booking.cancelled": clientBookingCancelled,
    "booking.rescheduled": clientBookingRescheduled,
    "booking.reminder": clientBookingReminder,
    "booking.ending_soon": clientBookingEndingSoon,
    ...paymentClientTemplates("gazebos"),
  },
  "ps-park": {
    "booking.created": clientBookingCreated,
    "booking.confirmed": clientBookingConfirmed,
    "booking.cancelled": clientBookingCancelled,
    "booking.reminder": clientBookingReminder,
    ...paymentClientTemplates("ps-park"),
  },
  cafe: {
    "order.placed": (d) =>
      `Заказ ${orderNo(d)} принят\n\nСумма: ${e(formatRub(d.totalAmount))} ₽${d.deliveryTo ? `\nДоставим в офис ${e(d.deliveryTo)}` : ""}\n\nНапишем, когда заказ будет готов.`,
    "order.preparing": (d) =>
      `Заказ ${orderNo(d)} готовится 👨‍🍳`,
    "order.ready": (d) =>
      d.deliveryTo
        ? `Заказ ${orderNo(d)} готов — скоро принесём в офис ${e(d.deliveryTo)}.`
        : `Заказ ${orderNo(d)} готов — заберите его на стойке кафе.`,
    "order.delivered": (d) =>
      `Заказ ${orderNo(d)} доставлен. Приятного аппетита!`,
    "order.cancelled": (d) =>
      `Заказ ${orderNo(d)} отменён.\n\nЕсли вы его не отменяли или есть вопросы, позвоните: ${PARK_PHONE}.`,
    ...paymentClientTemplates("cafe"),
  },
};

// ── Тексты для админ-чата модуля ───────────────────────────────────────────

/**
 * Новая бронь. Заголовок и последняя строка отвечают на вопрос «нужно ли мне
 * что-то делать» — раньше там стояло безусловное «Требуется подтверждение»,
 * хотя оплаченная онлайн бронь подтверждается сама.
 *
 * Бронь `online` (ждёт оплаты на сайте) до оплаты персоналу не показывается
 * вовсе (`staffAudience: "none"`). После оплаты общий чат узнаёт о ней из
 * `payment.succeeded`, а лично подписавшиеся — из этого же события с `paid`.
 */
function adminBookingCreated(moduleSlug: "gazebos" | "ps-park"): TemplateFn {
  return (d) => {
    const link = adminBookingLink(moduleSlug, d.bookingId);
    if (d.paid) {
      return `✅ <b>Новая бронь — оплачена онлайн</b>\n\n${adminBookingBlock(d)}\n\nБронь подтверждена — ничего делать не нужно.${link}`;
    }
    if (d.paymentFlow === "link") {
      return `🆕 <b>Новая бронь — ждёт оплаты</b>\n\n${adminBookingBlock(d)}\n\nБронь из бота или Mini App: клиенту отправлена ссылка на оплату. Оплатит — бронь подтвердится сама. Если договорились об оплате на месте, подтвердите бронь в панели.${link}`;
    }
    const action =
      moduleSlug === "ps-park"
        ? "Проверьте время и подтвердите бронь в панели. Если время не подходит — свяжитесь с клиентом."
        : "Онлайн-оплаты по брони нет. Свяжитесь с клиентом и подтвердите или отмените бронь в панели.";
    return `🆕 <b>Новая бронь — нужно подтвердить</b>\n\n${adminBookingBlock(d)}\n\n${action}${link}`;
  };
}

function adminBookingCancelled(moduleSlug: "gazebos" | "ps-park"): TemplateFn {
  return (d) => {
    const why =
      d.cancelledBecause === "unpaid"
        ? "Оплата не поступила — бронь отменилась автоматически, время снова свободно."
        : d.cancelledBy === "client"
          ? "Отменил клиент — время снова свободно."
          : "Отменена администратором.";
    return `❌ <b>Бронь отменена</b>\n\n${adminBookingBlock(d)}\n\n${why}${adminBookingLink(moduleSlug, d.bookingId)}`;
  };
}

/**
 * Онлайн-оплаты. Для брони `service.ts` подмешивает ресурс, слот и клиента
 * (по `subjectType`/`subjectId` платежа) — тогда сообщение самодостаточно и
 * заменяет «новую бронь»: беседка оплачена = подтверждена, делать ничего не надо.
 */
function paymentAdminTemplates(moduleSlug: string): Record<string, TemplateFn> {
  return {
    "payment.succeeded": (d) => {
      const isBooking = d.subjectType === "BOOKING" && Boolean(d.resourceName);
      const link = adminBookingLink(moduleSlug, d.bookingId);
      // Оплата, дошедшая после отмены брони (истекло окно, клиент заплатил по
      // старой ссылке), бронь не воскрешает — деньги есть, брони нет. Это
      // единственный случай, где по оплаченной брони смене нужно действовать.
      if (isBooking && (d.bookingStatus === "CANCELLED" || d.bookingStatus === "NO_SHOW")) {
        return `⚠️ <b>Оплата по отменённой брони: ${e(d.amount)} ₽</b>\n\n${adminBookingBlock(d)}\n\nБронь уже отменена, а деньги пришли. Восстановите бронь, если время свободно, или оформите клиенту возврат в панели.${link}`;
      }
      if (isBooking && moduleSlug === "gazebos") {
        return `✅ <b>Бронь оплачена онлайн: ${e(d.amount)} ₽</b>\n\n${adminBookingBlock(d)}\n\nБронь подтверждена — ничего делать не нужно.${link}`;
      }
      if (isBooking && moduleSlug === "ps-park") {
        return `💳 <b>Онлайн-оплата сессии: ${e(d.amount)} ₽</b>\n\n${adminBookingBlock(d)}${link}`;
      }
      return `💳 <b>Онлайн-оплата: ${e(d.amount)} ₽</b>\n\n${e(humanizeDates(d.description))}`;
    },
    "payment.refund.succeeded": (d) =>
      `↩️ <b>Возврат клиенту: ${e(d.amount)} ₽</b>\n\n${e(humanizeDates(d.description))}\n\nДеньги вернутся клиенту через ЮKassa, обычно за 1–3 дня.`,
  };
}

const rentalInquiry: TemplateFn = (d) => {
  const filled = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== "—";
  const lines = [`👤 ${e([d.name, d.phone].filter(filled).join(" · "))}`];
  if (filled(d.email)) lines.push(`Email: ${e(d.email)}`);
  if (filled(d.companyName)) lines.push(`Компания: ${e(d.companyName)}`);
  if (filled(d.officeNumber)) lines.push(`Офис: ${e(d.officeNumber)}`);
  const message = filled(d.message) ? `\n\nСообщение: ${e(d.message)}` : "";
  return `🏢 <b>Новая заявка на аренду офиса</b>\n\n${lines.join("\n")}${message}\n\nПерезвоните клиенту.`;
};

/**
 * Admin notification templates — sent to module admin group.
 * These use HTML formatting for Telegram.
 */
export const adminTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.created": adminBookingCreated("gazebos"),
    "booking.cancelled": adminBookingCancelled("gazebos"),
    ...paymentAdminTemplates("gazebos"),
  },
  "ps-park": {
    "booking.created": adminBookingCreated("ps-park"),
    "booking.cancelled": adminBookingCancelled("ps-park"),
    ...paymentAdminTemplates("ps-park"),
  },
  cafe: {
    "order.placed": (d) => {
      const client = formatClient(d);
      return `🍽 <b>Новый заказ ${orderNo(d)}</b>\n\n${client ? `👤 ${e(client)}\n` : ""}Сумма: ${e(formatRub(d.totalAmount))} ₽ · позиций: ${e(d.itemCount)}\n${d.deliveryTo ? `Доставить в офис ${e(d.deliveryTo)}` : "Самовывоз со стойки"}\n\nВозьмите заказ в работу в панели кафе.`;
    },
    "order.cancelled": (d) => {
      const client = formatClient(d);
      const why = d.cancelledBy === "client" ? "Клиент отменил заказ — готовить не нужно." : "Заказ отменён в панели.";
      return `❌ <b>Заказ ${orderNo(d)} отменён</b>\n\n${client ? `👤 ${e(client)}\n` : ""}Сумма: ${e(formatRub(d.totalAmount))} ₽\n\n${why}`;
    },
    ...paymentAdminTemplates("cafe"),
  },
  rental: {
    "contract.created": (d) =>
      `📄 <b>Новый договор аренды</b>\n\nАрендатор: ${e(d.tenantName)}\nОфис: ${e(d.officeNumber)}\nСтавка: ${e(formatRub(d.monthlyRate))} ₽/мес.\nСрок: ${e(formatEventDate(d.startDate, { withYear: true }))} — ${e(formatEventDate(d.endDate, { withYear: true }))}`,
    "contract.expiring": (d) =>
      `⏰ <b>Договор аренды заканчивается${Number.isFinite(Number(d.daysLeft)) ? ` через ${e(pluralDays(Number(d.daysLeft)))}` : ""}</b>\n\nАрендатор: ${e(d.tenantName)}\nОфис: ${e(d.officeNumber)}\nДата окончания: ${e(formatEventDate(d.endDate, { withYear: true }))}\n\nСвяжитесь с арендатором: продлеваем договор или готовим офис к новому.`,
    "inquiry.created": rentalInquiry,
  },
  "rental-inquiry": {
    "inquiry.created": rentalInquiry,
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
