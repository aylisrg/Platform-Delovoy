import type { BusinessPeriod } from "./business-types";
const DAY = 86_400_000;
export const businessDay = (date: Date) => new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
export function businessWindow(period: BusinessPeriod, now = new Date()) {
  const days = Number.parseInt(period);
  const end = new Date(`${businessDay(now)}T00:00:00+03:00`);
  const start = new Date(end.getTime() - days * DAY);
  return { start, end, previousStart: new Date(start.getTime() - days * DAY), days };
}
