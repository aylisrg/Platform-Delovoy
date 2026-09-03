import { getMoscowHour } from "@/lib/format";

/**
 * Перевод drag-события дневной сетки в «ресурс + время» (US-6, эпик #442;
 * ADR 2026-08-23 §5.2–5.3). Чистые функции без DOM: сетка позиционирует брони
 * в процентах от рабочего дня, поэтому drop нельзя «поймать ячейкой» —
 * смещение считается от сдвига блока (`delta.x`), а не от курсора, и
 * привязывается к шагу в полчаса.
 *
 * Здесь нет ни проверки конфликтов, ни бизнес-правил длительности: их делает
 * сервер (`rescheduleBooking()` под advisory-lock, 409/422), клиент лишь
 * готовит тело того же PATCH, что шлёт форма редактирования.
 */

export const DRAG_STEP_MINUTES = 30;

/** Часы с дробью внутри рабочего дня по МСК: 13.5 = 13:30. */
export type HourRange = {
  startHour: number;
  endHour: number;
};

/** Сдвиг блока в px → часы, по ширине дорожки одного дня. */
export function pxDeltaToHours(
  deltaPx: number,
  trackWidthPx: number,
  openHour: number,
  closeHour: number
): number {
  if (!(trackWidthPx > 0) || closeHour <= openHour) return 0;
  return (deltaPx / trackWidthPx) * (closeHour - openHour);
}

/** Округление к ближайшему шагу (по умолчанию 30 минут). */
export function snapHours(hours: number, stepMinutes: number = DRAG_STEP_MINUTES): number {
  const perHour = 60 / stepMinutes;
  return Math.round(hours * perHour) / perHour;
}

/** Перенос: обе границы сдвигаются, длительность сохраняется. */
export function shiftBooking(range: HourRange, deltaHours: number): HourRange {
  return { startHour: range.startHour + deltaHours, endHour: range.endHour + deltaHours };
}

/** Растяжение правого края: меняется только конец, не короче одного шага. */
export function resizeBookingEnd(range: HourRange, deltaHours: number, stepMinutes: number = DRAG_STEP_MINUTES): HourRange {
  const minEnd = range.startHour + stepMinutes / 60;
  return { startHour: range.startHour, endHour: Math.max(minEnd, range.endHour + deltaHours) };
}

/**
 * Вписать диапазон в рабочий день, сохранив длительность; если бронь длиннее
 * дня — обрезать по закрытию. Выход за границы всё равно поймает сервер
 * (`OUTSIDE_WORKING_HOURS`), это лишь защита от заведомо бессмысленного запроса.
 */
export function clampToWorkingHours(range: HourRange, openHour: number, closeHour: number): HourRange {
  const duration = Math.max(0, range.endHour - range.startHour);
  let start = range.startHour;
  if (start < openHour) start = openHour;
  if (start + duration > closeHour) start = Math.max(openHour, closeHour - duration);
  return { startHour: start, endHour: Math.min(closeHour, start + duration) };
}

/** 13.5 → "13:30" — формат полей `startTime`/`endTime` PATCH-запроса. */
export function hoursToHHMM(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** Границы брони как дробные часы МСК из ISO-времени. */
export function bookingHourRange(startIso: string, endIso: string): HourRange {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return {
    startHour: getMoscowHour(start) + start.getMinutes() / 60,
    endHour: getMoscowHour(end) + end.getMinutes() / 60,
  };
}

export type DropPlan = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * Итог drop'а: тело PATCH или `null`, если после привязки к шагу ничего не
 * изменилось — микро-сдвиг мышью не должен становиться реальным переносом
 * с уведомлением гостю (ADR §5.3 п.5).
 */
export function planDrop(input: {
  original: HourRange;
  next: HourRange;
  originalResourceId: string;
  targetResourceId: string;
  date: string;
}): DropPlan | null {
  const sameTime =
    Math.abs(input.next.startHour - input.original.startHour) < 1e-9 &&
    Math.abs(input.next.endHour - input.original.endHour) < 1e-9;
  if (sameTime && input.originalResourceId === input.targetResourceId) return null;
  return {
    resourceId: input.targetResourceId,
    date: input.date,
    startTime: hoursToHHMM(input.next.startHour),
    endTime: hoursToHHMM(input.next.endHour),
  };
}
