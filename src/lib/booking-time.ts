/**
 * Pure helpers for PS Park admin booking UI (mobile + desktop share logic).
 *
 * All times are "HH:MM" strings in Moscow timezone (store closes at 23:00).
 */

export const OPEN_HHMM = "08:00";
export const CLOSE_HHMM = "23:00";

/** Duration options (minutes) offered as chips in mobile booking sheet. */
export const DURATION_CHIPS_MIN = [30, 60, 90, 120, 180, 240];

export function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHMM(totalMin: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, totalMin));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Round duration up to nearest 30 min, return in hours (0.5, 1, 1.5, ...). */
export function billedHours(startHHMM: string, endHHMM: string): number {
  const min = durationMinutes(startHHMM, endHHMM);
  if (min <= 0) return 0;
  return Math.ceil(min / 30) * 0.5;
}

export function durationMinutes(startHHMM: string, endHHMM: string): number {
  return parseHHMM(endHHMM) - parseHHMM(startHHMM);
}

export function durationLabel(startHHMM: string, endHHMM: string): string {
  const min = durationMinutes(startHHMM, endHHMM);
  if (min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}ч ${m}мин` : `${h}ч`) : `${m}мин`;
}

/**
 * Given a start time and a desired duration, compute an end time clamped
 * to either maxEndTime (next booking or close) or CLOSE_HHMM.
 */
export function endTimeFromDuration(
  startHHMM: string,
  durationMin: number,
  maxEndHHMM: string = CLOSE_HHMM,
): string {
  const start = parseHHMM(startHHMM);
  const maxEnd = Math.min(parseHHMM(maxEndHHMM), parseHHMM(CLOSE_HHMM));
  return formatHHMM(Math.min(start + durationMin, maxEnd));
}

/** Max selectable duration in minutes from start until maxEnd. */
export function maxDurationMin(startHHMM: string, maxEndHHMM: string): number {
  const diff = parseHHMM(maxEndHHMM) - parseHHMM(startHHMM);
  return Math.max(0, Math.min(diff, parseHHMM(CLOSE_HHMM) - parseHHMM(startHHMM)));
}

/** Which chip (in minutes) is currently selected by end time, or null. */
export function selectedChip(
  startHHMM: string,
  endHHMM: string,
  chips: number[] = DURATION_CHIPS_MIN,
): number | null {
  const diff = durationMinutes(startHHMM, endHHMM);
  return chips.includes(diff) ? diff : null;
}

/**
 * Enumerate 30-minute slots between OPEN and CLOSE.
 * Used by mobile timeline grid.
 */
export function generateHalfHourSlots(
  openHHMM: string = OPEN_HHMM,
  closeHHMM: string = CLOSE_HHMM,
): string[] {
  const start = parseHHMM(openHHMM);
  const end = parseHHMM(closeHHMM);
  const out: string[] = [];
  for (let t = start; t < end; t += 30) out.push(formatHHMM(t));
  return out;
}

/**
 * Given a list of bookings on the same resource + a slot start,
 * return the earliest next booking start or CLOSE_HHMM.
 */
export function getMaxEndFromBookings(
  slotStartHHMM: string,
  bookingsOnResource: Array<{ startHHMM: string; endHHMM: string }>,
  closeHHMM: string = CLOSE_HHMM,
): string {
  const slotMin = parseHHMM(slotStartHHMM);
  let best = parseHHMM(closeHHMM);
  for (const b of bookingsOnResource) {
    const bs = parseHHMM(b.startHHMM);
    if (bs > slotMin && bs < best) best = bs;
  }
  return formatHHMM(best);
}

/**
 * Is a 30-min slot starting at slotHHMM free on the given bookings?
 */
export function isSlotFree(
  slotHHMM: string,
  bookingsOnResource: Array<{ startHHMM: string; endHHMM: string }>,
): boolean {
  const slotStart = parseHHMM(slotHHMM);
  const slotEnd = slotStart + 30;
  return !bookingsOnResource.some(
    (b) => parseHHMM(b.startHHMM) < slotEnd && parseHHMM(b.endHHMM) > slotStart,
  );
}
