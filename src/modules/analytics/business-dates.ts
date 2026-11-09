import type { BusinessGranularity, BusinessRangeInput } from "./business-types";
const DAY = 86_400_000;
export const businessDay = (date: Date) => new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
/** Start of a Moscow calendar day (MSK has no DST). */
export const moscowMidnight = (day: string) => new Date(`${day}T00:00:00+03:00`);
/** Number of calendar days in an inclusive YYYY-MM-DD range. */
export const rangeDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
/**
 * Report window: preset periods end at the start of the current Moscow day
 * (only completed days); a custom range covers its inclusive dates. The
 * comparison window is the equal-length span right before it.
 */
export function businessWindow(input: BusinessRangeInput, now = new Date()) {
  let start: Date, end: Date, days: number;
  if (typeof input === "string") {
    days = Number.parseInt(input);
    end = moscowMidnight(businessDay(now));
    start = new Date(end.getTime() - days * DAY);
  } else {
    days = rangeDays(input.from, input.to);
    start = moscowMidnight(input.from);
    end = new Date(start.getTime() + days * DAY);
  }
  return { start, end, previousStart: new Date(start.getTime() - days * DAY), days };
}
/** Readable default: days for short ranges, ISO weeks up to half a year, then months. */
export function defaultGranularity(days: number): BusinessGranularity {
  return days <= 45 ? "day" : days <= 186 ? "week" : "month";
}
/** Key of the bucket that a Moscow day belongs to: the day, its ISO-week Monday, or the 1st of its month. */
export function bucketKey(day: string, granularity: BusinessGranularity) {
  if (granularity === "day") return day;
  if (granularity === "month") return `${day.slice(0, 7)}-01`;
  const date = new Date(`${day}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - shift * DAY).toISOString().slice(0, 10);
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));
/**
 * Calendar shortcuts for the custom range picker. `today` is the current
 * Moscow date; every range ends no later than yesterday (completed days only).
 */
export function businessCalendarRanges(today: string): { key: string; label: string; from: string; to: string }[] {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const yesterday = iso(new Date(Date.parse(`${today}T00:00:00Z`) - DAY));
  const quarter = Math.floor(month / 3);
  const ranges = [
    { key: "last-month", label: "Прошлый месяц", from: iso(utc(year, month - 1, 1)), to: iso(utc(year, month, 0)) },
    { key: "last-quarter", label: "Прошлый квартал", from: iso(utc(year, (quarter - 1) * 3, 1)), to: iso(utc(year, quarter * 3, 0)) },
    { key: "year-to-date", label: "С начала года", from: `${year}-01-01`, to: yesterday },
    { key: "last-year", label: "Прошлый год", from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
  return ranges.filter(range => range.from <= range.to);
}
