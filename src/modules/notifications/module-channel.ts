import { prisma } from "@/lib/db";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/escape";
import type { NotificationEvent } from "./types";
import { adminBookingLink, formatClient, formatSlot } from "./text-format";

/**
 * Dedicated per-module Telegram channel delivery.
 *
 * Independent from the per-user dispatch layer: this is a broadcast to a single
 * group/channel chat configured per module in `Module.config`, filtered by an
 * admin-controlled list of event types. No per-user preferences / quiet hours
 * apply — it's a module-wide feed.
 *
 * Config keys (Module.config JSON):
 *   - telegramChannelEnabled: boolean   — master switch
 *   - telegramChannelId: string         — chat_id or @username (bot must be able to post)
 *   - telegramChannelEvents: string[]   — enabled event types
 *   - telegramBotToken?: string         — optional per-module bot override
 */

type TemplateFn = (d: Record<string, unknown>) => string | null;

/** HTML-ссылка «Открыть бронь в панели» (пусто, если bookingId неизвестен). */
function adminLink(moduleSlug: string, d: Record<string, unknown>): string {
  return adminBookingLink(moduleSlug, d.bookingId);
}

/**
 * Ссылка на расписание беседок с открытой бронью — там у админа есть кнопка
 * «Изменить», которой продлевается время. Служит «ссылкой на продление».
 */
function gazeboExtendLink(d: Record<string, unknown>): string {
  if (!d.bookingId) return "";
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const id = encodeURIComponent(String(d.bookingId));
  // Расписанию нужна ISO-дата (YYYY-MM-DD); d.date — локализованная для показа.
  const date = d.dateISO ? `&date=${encodeURIComponent(String(d.dateISO))}` : "";
  return `\n\n<a href="${base}/admin/gazebos?booking=${id}${date}">Продлить (изменить время)</a>`;
}

/** Ресурс, слот и (если известен) клиент — общий блок всех постов о брони. */
function bookingBlock(d: Record<string, unknown>, opts: { withPhone?: boolean } = {}): string {
  const lines = [escapeHtml(d.resourceName), `📅 ${escapeHtml(formatSlot(d))}`];
  const client = opts.withPhone
    ? formatClient(d)
    : formatClient({ clientName: d.clientName });
  if (client) lines.push(`👤 ${escapeHtml(client)}`);
  return lines.join("\n");
}

function rescheduleBlock(d: Record<string, unknown>): string {
  const was = formatSlot({ date: d.oldDate, startTime: d.oldStartTime, endTime: d.oldEndTime });
  const lines = [
    escapeHtml(d.resourceName),
    `Было: ${escapeHtml(was)}`,
    `Стало: ${escapeHtml(formatSlot(d))}`,
  ];
  const client = formatClient({ clientName: d.clientName });
  if (client) lines.push(`👤 ${escapeHtml(client)}`);
  return lines.join("\n");
}

const amountLine = (d: Record<string, unknown>) =>
  d.amount ? `\nСумма: ${escapeHtml(d.amount)} ₽` : "";

/**
 * Отмена неоплаченной брони (истекло окно онлайн-оплаты) — не новость для
 * канала: сам канал узнаёт о брони только после оплаты (`booking.paid`) или
 * при брони по телефону, так что «отмену» он видел бы без «создания».
 */
const isUnpaidCancellation = (d: Record<string, unknown>) => d.cancelledBecause === "unpaid";

/**
 * HTML-formatted channel templates per module + event type.
 *
 * В выделенный канал попадают только «оплаченные» брони: событие
 * `booking.paid` шлётся строго после успешной онлайн-оплаты и несёт ссылку
 * на бронь. `booking.created`/`booking.confirmed` намеренно НЕ имеют шаблона —
 * так даже старый сохранённый `telegramChannelEvents` не запостит неоплаченную
 * бронь (render → null) и исключается двойной пост confirmed+paid.
 *
 * Исключение — `booking.admin_created` (#437): бронь, принятая админом по
 * телефону, создаётся сразу CONFIRMED и в канал иначе никогда бы не попала —
 * у неё есть отдельный шаблон, не завязанный на онлайн-оплату.
 */
const channelTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.paid": (d) =>
      `💳 <b>Бронь оплачена онлайн</b>\n\n${bookingBlock(d)}${amountLine(d)}\n\nБронь подтверждена — ждём гостей.${adminLink("gazebos", d)}`,
    "booking.admin_created": (d) =>
      `📞 <b>Бронь по телефону</b>\n\n${bookingBlock(d, { withPhone: true })}\n\nБронь уже подтверждена администратором.${adminLink("gazebos", d)}`,
    "booking.cancelled": (d) =>
      isUnpaidCancellation(d)
        ? null
        : `❌ <b>Бронь отменена</b>\n\n${bookingBlock(d)}\n\nВремя снова свободно.${adminLink("gazebos", d)}`,
    "booking.completed": (d) =>
      `🏁 <b>Бронь завершена</b>\n\n${bookingBlock(d)}${adminLink("gazebos", d)}`,
    "booking.deleted": (d) =>
      `🗑 <b>Бронь удалена</b>\n\n${bookingBlock(d)}`,
    "booking.rescheduled": (d) =>
      `🔄 <b>Бронь перенесена</b>\n\n${rescheduleBlock(d)}${adminLink("gazebos", d)}`,
    "booking.reminder": (d) =>
      `⏰ <b>Через час приезжают гости</b>\n\n${bookingBlock(d)}\n\nПроверьте, что беседка готова.`,
    "booking.ending_soon": (d) =>
      `⏳ <b>Бронь закончится через час</b>\n\n${bookingBlock(d, { withPhone: true })}\n\nПредложите гостям продлить, если следом беседка свободна.${gazeboExtendLink(d)}`,
  },
  cafe: {
    // QR-чекаут: постим только оплаченные заказы (order.paid шлётся строго
    // после успешной онлайн-оплаты). order.placed шаблона намеренно нет —
    // неоплаченные корзины в канал не попадают.
    "order.paid": (d) =>
      `☕ <b>Оплачен заказ #${escapeHtml(d.orderNumber)} — можно готовить</b>\n\nСумма: ${escapeHtml(d.amount)} ₽\nСостав: ${escapeHtml(d.itemsSummary)}\n${d.deliveryTo ? `Принести в офис: ${escapeHtml(d.deliveryTo)}` : "Самообслуживание — гость заберёт у кассы"}\n\n<a href="${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") + "/admin/cafe"}">Открыть заказы в панели</a>`,
  },
  "ps-park": {
    // «Онлайн-оплата», а не «оплачена»: счёт ps-park может оплачиваться
    // частями (несколько платежей), поэтому каждое событие — это принятый
    // онлайн-платёж, а не факт полной оплаты сессии.
    "booking.paid": (d) =>
      `💳 <b>Онлайн-оплата сессии</b>\n\n${bookingBlock(d)}${amountLine(d)}${adminLink("ps-park", d)}`,
    "booking.admin_created": (d) =>
      `📞 <b>Сессия по телефону</b>\n\n${bookingBlock(d, { withPhone: true })}\n\nСессия уже подтверждена администратором.${adminLink("ps-park", d)}`,
    "booking.cancelled": (d) =>
      isUnpaidCancellation(d)
        ? null
        : `❌ <b>Сессия отменена</b>\n\n${bookingBlock(d)}\n\nСтол снова свободен.${adminLink("ps-park", d)}`,
    "booking.completed": (d) =>
      `🏁 <b>Сессия завершена</b>\n\n${bookingBlock(d)}${adminLink("ps-park", d)}`,
    "booking.reminder": (d) =>
      `⏰ <b>Через час начинается сессия</b>\n\n${bookingBlock(d)}\n\nПроверьте, что стол свободен и готов.`,
  },
};

function renderChannelMessage(
  moduleSlug: string,
  eventType: string,
  data: Record<string, unknown>
): string | null {
  const template = channelTemplates[moduleSlug]?.[eventType];
  if (!template) return null;
  return template(data);
}

/**
 * Deliver an event to the module's dedicated Telegram channel when enabled and
 * the event type is toggled on. Fails soft — never throws to the caller.
 */
export async function dispatchModuleChannel(
  event: NotificationEvent
): Promise<void> {
  // Канал — общая лента смены, как и админ-чат: событие с суженной аудиторией
  // персонала (NotificationEvent.staffAudience) сюда не идёт.
  if (event.staffAudience) return;

  try {
    const moduleRecord = await prisma.module.findUnique({
      where: { slug: event.moduleSlug },
      select: { config: true },
    });
    const config = (moduleRecord?.config as Record<string, unknown>) ?? {};

    if (config.telegramChannelEnabled !== true) return;

    const chatId =
      typeof config.telegramChannelId === "string"
        ? config.telegramChannelId.trim()
        : "";
    if (!chatId) return;

    const enabledEvents = Array.isArray(config.telegramChannelEvents)
      ? (config.telegramChannelEvents as string[])
      : [];
    if (!enabledEvents.includes(event.type)) return;

    const text = renderChannelMessage(event.moduleSlug, event.type, event.data);
    if (!text) return;

    const token =
      (typeof config.telegramBotToken === "string" && config.telegramBotToken) ||
      process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn(
        "[ModuleChannel] TELEGRAM_BOT_TOKEN not set, skipping channel delivery"
      );
      return;
    }

    const res = await telegramApi(
      "sendMessage",
      { chat_id: chatId, text, parse_mode: "HTML" },
      { botToken: token }
    );
    if (!res.ok) {
      console.error("[ModuleChannel] Telegram send failed:", res.description);
    }
  } catch (err) {
    console.error("[ModuleChannel] Dispatch error:", err);
  }
}
