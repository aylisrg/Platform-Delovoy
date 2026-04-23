/**
 * Единая точка форматирования дат/времени в продукте.
 *
 * Стандарты (ADR 2026-04-23):
 * - Время: 24-часовой формат `HH:mm` (например `09:00`, `18:30`).
 * - Дата: `дд-мм-гггг` через дефис (например `23-04-2026`).
 * - Дата+время: `дд-мм-гггг HH:mm` (например `23-04-2026 18:30`).
 * - Timezone отображения: Europe/Moscow. В БД храним UTC.
 *
 * ВСЕ компоненты UI, email-шаблоны, bot-сообщения и экспорты обязаны импортировать
 * формат отсюда. Прямой вызов `Date.prototype.toLocaleDateString/toLocaleTimeString`
 * и `new Intl.DateTimeFormat` запрещён ESLint-правилом в `src/components/**`
 * и `src/app/**`.
 *
 * Все функции толерантны к `null`/`undefined` — возвращают пустую строку.
 * Вход: `Date | string (ISO) | number (epoch ms) | null | undefined`.
 */

export const TZ = "Europe/Moscow" as const;

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Извлекает компоненты даты/времени в указанной таймзоне через Intl.
 * Одно место, где Intl.DateTimeFormat допустим — внутри format.ts.
 */
function getMoscowParts(d: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  // Intl quirk: "hour: '2-digit', hour12: false" can emit "24" for midnight in some runtimes.
  if (out.hour === "24") out.hour = "00";
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
  };
}

/** `"23-04-2026"` (Moscow TZ). Пустая строка для null/invalid. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const { year, month, day } = getMoscowParts(d);
  return `${day}-${month}-${year}`;
}

/** `"18:30"` — 24-часовой HH:mm в Moscow TZ. Пустая строка для null/invalid. */
export function formatTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const { hour, minute } = getMoscowParts(d);
  return `${hour}:${minute}`;
}

/** `"23-04-2026 18:30"` — комбинированный формат. */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const { year, month, day, hour, minute } = getMoscowParts(d);
  return `${day}-${month}-${year} ${hour}:${minute}`;
}

/**
 * Парсит `"дд-мм-гггг"` в `Date`, указывающий на полуночи того дня в Moscow TZ.
 * Бросает Error при невалидном вводе.
 */
export function parseDate(ddmmyyyy: string): Date {
  if (typeof ddmmyyyy !== "string") {
    throw new Error(`parseDate: expected string, got ${typeof ddmmyyyy}`);
  }
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmyyyy.trim());
  if (!match) {
    throw new Error(`parseDate: expected "дд-мм-гггг", got "${ddmmyyyy}"`);
  }
  const [, ddStr, mmStr, yyyyStr] = match;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  if (mm < 1 || mm > 12) {
    throw new Error(`parseDate: month out of range: ${mm}`);
  }
  if (dd < 1 || dd > 31) {
    throw new Error(`parseDate: day out of range: ${dd}`);
  }
  // Представим как полуночь в Moscow TZ. Europe/Moscow — UTC+3 без DST с 2011.
  // Для корректности при возможных исторических сдвигах — вычислим смещение через Intl.
  // Сначала построим "наивный" UTC из компонентов и скорректируем по diff.
  const naiveUtc = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0);
  const offsetMs = moscowOffsetMs(new Date(naiveUtc));
  const d = new Date(naiveUtc - offsetMs);
  // Sanity: обратный рендер должен совпасть.
  if (formatDate(d) !== ddmmyyyy.trim()) {
    throw new Error(`parseDate: invalid calendar date "${ddmmyyyy}"`);
  }
  return d;
}

/**
 * Смещение Moscow TZ относительно UTC в миллисекундах (+3h обычно).
 * Вычисляется через Intl, чтобы быть устойчивым к историческим правкам TZDB.
 */
function moscowOffsetMs(at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    map.hour === "24" ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - at.getTime();
}

/** Для `<input type="date">`: `"2026-04-23"` (HTML5 требует ISO). */
export function toISODate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const { year, month, day } = getMoscowParts(d);
  return `${year}-${month}-${day}`;
}

/** Для `<input type="datetime-local">`: `"2026-04-23T18:30"`. */
export function toISODateTimeLocal(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const { year, month, day, hour, minute } = getMoscowParts(d);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** Час (0..23) в Moscow TZ. Заменяет локальный `getMoscowHour` из ps-park/service. */
export function getMoscowHour(value: DateInput): number {
  const d = toDate(value);
  if (!d) return NaN;
  const { hour } = getMoscowParts(d);
  return Number(hour);
}
