/**
 * Общие куски текстов уведомлений: человекочитаемая дата, слот брони, строка
 * клиента, ссылка на бронь в панели.
 *
 * Leaf-модуль без БД — импортируется шаблонами Telegram (клиент/админ-чат/
 * канал), браузерными уведомлениями и письмами, чтобы одна и та же бронь везде
 * выглядела одинаково («сб, 10 октября · 16:00–22:00», а не «2026-10-10»).
 */

export const PARK_PHONE = "+7 (499) 677-48-88";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RU_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * Дата события для людей: «сб, 10 октября» (с `withYear` — «10 октября 2026 г.»).
 *
 * Места вызова передают дату по-разному: ISO `YYYY-MM-DD` (бронирования,
 * договоры) или `toLocaleDateString("ru-RU")` — `DD.MM.YYYY` (планировщик
 * напоминаний). Оба формата разбираем как календарную дату без часового пояса;
 * всё остальное (уже готовый текст, пусто) возвращаем как есть.
 */
export function formatEventDate(value: unknown, options: { withYear?: boolean } = {}): string {
  const raw = String(value ?? "").trim();
  const iso = ISO_DATE.exec(raw);
  const ru = RU_DATE.exec(raw);
  const parts = iso
    ? { y: iso[1], m: iso[2], d: iso[3] }
    : ru
      ? { y: ru[3], m: ru[2], d: ru[1] }
      : null;
  if (!parts) return raw;

  const date = new Date(Date.UTC(Number(parts.y), Number(parts.m) - 1, Number(parts.d)));
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleDateString(
    "ru-RU",
    options.withYear
      ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }
  );
}

/** Слот брони одной строкой: «сб, 10 октября · 16:00–22:00». */
export function formatSlot(d: Record<string, unknown>): string {
  const date = formatEventDate(d.date);
  const time = d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : String(d.startTime ?? "");
  return [date, time].filter(Boolean).join(" · ");
}

/**
 * Клиент одной строкой: «Иван Петров · +7 999 123-45-67». Пустая строка, если
 * ни имени, ни телефона нет — шаблон тогда опускает строку целиком, а не
 * печатает пустое «Клиент:».
 */
export function formatClient(d: Record<string, unknown>): string {
  const name = String(d.clientName || d.userName || "").trim();
  const phone = String(d.clientPhone || "").trim();
  return [name, phone].filter(Boolean).join(" · ");
}

/** Сумма в рублях с разрядами: «12 000». Нечисловое значение — как есть. */
export function formatRub(value: unknown): string {
  const num = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(num)) {
    return String(value ?? "");
  }
  return num.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/** «1 день», «3 дня», «15 дней». */
export function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/**
 * Абсолютная ссылка на конкретную бронь в админке. Единый источник знания о
 * форме админ-маршрута по модулю: gazebos → страница брони, ps-park → сессия.
 */
export function adminBookingUrl(moduleSlug: string, bookingId: unknown): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const id = encodeURIComponent(String(bookingId ?? ""));
  const path =
    moduleSlug === "ps-park"
      ? `/admin/ps-park/sessions/${id}`
      : `/admin/gazebos/bookings/${id}`;
  return `${base}${path}`;
}

/** HTML-ссылка на бронь в панели (пусто, если bookingId неизвестен). */
export function adminBookingLink(moduleSlug: string, bookingId: unknown): string {
  if (!bookingId) return "";
  return `\n\n<a href="${adminBookingUrl(moduleSlug, bookingId)}">Открыть бронь в панели</a>`;
}
