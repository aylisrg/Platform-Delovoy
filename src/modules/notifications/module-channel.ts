import { prisma } from "@/lib/db";
import { telegramApi } from "@/lib/telegram/client";
import type { NotificationEvent } from "./types";

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

type TemplateFn = (d: Record<string, unknown>) => string;

/** Экранирование для parse_mode=HTML (имена/названия из пользовательского ввода). */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Абсолютная ссылка на конкретную бронь в админке. Единый источник знания о
 * форме админ-маршрута по модулю: gazebos → страница брони, ps-park → сессия.
 */
function adminBookingUrl(moduleSlug: string, bookingId: unknown): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const id = encodeURIComponent(String(bookingId ?? ""));
  const path =
    moduleSlug === "ps-park"
      ? `/admin/ps-park/sessions/${id}`
      : `/admin/gazebos/bookings/${id}`;
  return `${base}${path}`;
}

/** HTML-ссылка «Открыть в панели» на бронь (пусто, если bookingId неизвестен). */
function adminLink(moduleSlug: string, d: Record<string, unknown>): string {
  if (!d.bookingId) return "";
  return `\n\n<a href="${adminBookingUrl(moduleSlug, d.bookingId)}">Открыть в панели</a>`;
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

/**
 * HTML-formatted channel templates per module + event type.
 *
 * В выделенный канал попадают только «оплаченные» брони: событие
 * `booking.paid` шлётся строго после успешной онлайн-оплаты и несёт ссылку
 * на бронь. `booking.created`/`booking.confirmed` намеренно НЕ имеют шаблона —
 * так даже старый сохранённый `telegramChannelEvents` не запостит неоплаченную
 * бронь (render → null) и исключается двойной пост confirmed+paid.
 */
const channelTemplates: Record<string, Record<string, TemplateFn>> = {
  gazebos: {
    "booking.paid": (d) =>
      `💳 <b>Бронь оплачена</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.clientName ? `\nКлиент: ${escapeHtml(d.clientName)}` : ""}${d.amount ? `\nСумма: ${d.amount} ₽` : ""}${adminLink("gazebos", d)}`,
    "booking.cancelled": (d) =>
      `❌ <b>Бронь отменена</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.clientName ? `\nКлиент: ${escapeHtml(d.clientName)}` : ""}${adminLink("gazebos", d)}`,
    "booking.completed": (d) =>
      `🏁 <b>Бронь завершена</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${adminLink("gazebos", d)}`,
    "booking.deleted": (d) =>
      `🗑 <b>Бронь удалена</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.clientName ? `\nКлиент: ${escapeHtml(d.clientName)}` : ""}`,
    "booking.reminder": (d) =>
      `⏰ <b>Напоминание</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
    "booking.ending_soon": (d) =>
      `⏳ <b>Бронь скоро заканчивается</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nОкончание: ${d.endTime}${d.clientName ? `\nКлиент: ${escapeHtml(d.clientName)}` : ""}${d.clientPhone ? `\nТелефон: ${escapeHtml(d.clientPhone)}` : ""}\n\nПредложите клиенту продлить.${gazeboExtendLink(d)}`,
  },
  cafe: {
    // QR-чекаут: постим только оплаченные заказы (order.paid шлётся строго
    // после успешной онлайн-оплаты). order.placed шаблона намеренно нет —
    // неоплаченные корзины в канал не попадают.
    "order.paid": (d) =>
      `☕ <b>Оплачен заказ #${escapeHtml(d.orderNumber)}</b>\n\nСумма: ${d.amount} ₽\nСостав: ${escapeHtml(d.itemsSummary)}\n${d.deliveryTo ? `Принести: ${escapeHtml(d.deliveryTo)}` : "Самообслуживание — выдан у кассы"}\n\n<a href="${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") + "/admin/cafe"}">Открыть в панели</a>`,
  },
  "ps-park": {
    // «Онлайн-оплата», а не «оплачена»: счёт ps-park может оплачиваться
    // частями (несколько платежей), поэтому каждое событие — это принятый
    // онлайн-платёж, а не факт полной оплаты сессии.
    "booking.paid": (d) =>
      `💳 <b>Онлайн-оплата сессии</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${d.clientName ? `\nКлиент: ${escapeHtml(d.clientName)}` : ""}${d.amount ? `\nСумма: ${d.amount} ₽` : ""}${adminLink("ps-park", d)}`,
    "booking.cancelled": (d) =>
      `❌ <b>Сессия отменена</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${adminLink("ps-park", d)}`,
    "booking.completed": (d) =>
      `🏁 <b>Сессия завершена</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}${adminLink("ps-park", d)}`,
    "booking.reminder": (d) =>
      `⏰ <b>Напоминание</b>\n\n${escapeHtml(d.resourceName)}\nДата: ${d.date}\nВремя: ${d.startTime} — ${d.endTime}`,
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
