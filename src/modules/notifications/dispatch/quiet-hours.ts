/**
 * Quiet hours utilities. Pure / no DB.
 *
 * `from`/`to` strings are "HH:MM" 24h. The window may cross midnight
 * (e.g. from "22:00" to "07:00").
 */
export type QuietHours = {
  from: string | null;
  to: string | null;
  timezone: string;
  weekdaysOnly?: boolean;
};

export function parseHHMM(s: string | null | undefined): { h: number; m: number } | null {
  if (!s) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

/**
 * Convert a Date to {h, m, dow} in the given IANA timezone using Intl.
 * Returns null on invalid timezone.
 */
export function dateInTz(
  d: Date,
  timezone: string
): { h: number; m: number; dow: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    const parts = fmt.formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    const wk = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wk);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return { h: h % 24, m, dow };
  } catch {
    return null;
  }
}

export function isInQuietHours(now: Date, q: QuietHours): boolean {
  const from = parseHHMM(q.from);
  const to = parseHHMM(q.to);
  if (!from || !to) return false;
  const local = dateInTz(now, q.timezone);
  if (!local) return false;
  if (q.weekdaysOnly && (local.dow === 0 || local.dow === 6)) return false;

  const cur = local.h * 60 + local.m;
  const fr = from.h * 60 + from.m;
  const tr = to.h * 60 + to.m;

  if (fr === tr) return false;
  if (fr < tr) return cur >= fr && cur < tr;
  // crosses midnight: (fr..24) ∪ (0..tr)
  return cur >= fr || cur < tr;
}

/**
 * Compute the next moment at which `to` time occurs (quiet hours end).
 * Used to schedule DEFERRED notifications.
 */
export function nextQuietHoursEnd(now: Date, q: QuietHours): Date {
  const to = parseHHMM(q.to);
  if (!to) return now;
  const local = dateInTz(now, q.timezone);
  if (!local) return now;

  // Compute minutes from "now in tz" to next occurrence of `to`
  const cur = local.h * 60 + local.m;
  const target = to.h * 60 + to.m;
  let deltaMinutes = target - cur;
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  return new Date(now.getTime() + deltaMinutes * 60_000);
}
