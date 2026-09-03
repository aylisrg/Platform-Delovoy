/**
 * Чистая календарная арифметика недельного вида (US-5, эпик #442) — без
 * Prisma, чтобы её могли импортировать и сервис `week-timeline.ts`, и
 * клиентский компонент недельной матрицы. Арифметика по UTC-полуночи
 * календарной даты — как `DateNavigator.shiftDate`, чтобы результат не зависел
 * от часового пояса браузера (ADR 2026-08-23 §9 п.2).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Понедельник недели, содержащей дату (неделя Пн–Вс). */
export function normalizeWeekStart(date: string): string {
  const d = utcMidnight(date);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Вс=0 → 6, Пн=1 → 0
  return toDateKey(new Date(d.getTime() - daysSinceMonday * DAY_MS));
}

/** Семь дат недели от понедельника включительно. */
export function weekDays(weekStart: string): string[] {
  const start = utcMidnight(weekStart);
  return Array.from({ length: 7 }, (_, i) => toDateKey(new Date(start.getTime() + i * DAY_MS)));
}

/** Сдвиг даты на N дней (для навигации по неделям: ±7). */
export function shiftDateKey(date: string, days: number): string {
  return toDateKey(new Date(utcMidnight(date).getTime() + days * DAY_MS));
}

/** ["08:00", …, "22:00"] для openHour=8, closeHour=23 — как у дневного таймлайна. */
export function hoursRange(openHour: number, closeHour: number): string[] {
  return Array.from({ length: Math.max(0, closeHour - openHour) }, (_, i) =>
    `${(openHour + i).toString().padStart(2, "0")}:00`
  );
}

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

/** «Пн 17.06» — заголовок колонки дня; парсится из строки, без TZ браузера. */
export function formatDayHeader(date: string): string {
  const d = utcMidnight(date);
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/** «17.06 – 23.06.2030» — подпись недели в навигаторе. */
export function formatWeekLabel(weekStart: string): string {
  const days = weekDays(weekStart);
  const first = days[0];
  const last = days[6];
  const ddmm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
  return `${ddmm(first)} – ${ddmm(last)}.${last.slice(0, 4)}`;
}
