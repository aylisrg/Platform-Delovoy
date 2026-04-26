import { describe, expect, it } from "vitest";
import {
  isInQuietHours,
  nextQuietHoursEnd,
  parseHHMM,
} from "../quiet-hours";

describe("parseHHMM", () => {
  it("parses valid HH:MM", () => {
    expect(parseHHMM("00:00")).toEqual({ h: 0, m: 0 });
    expect(parseHHMM("23:59")).toEqual({ h: 23, m: 59 });
    expect(parseHHMM("09:30")).toEqual({ h: 9, m: 30 });
  });
  it("rejects invalid", () => {
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("9:30")).toBeNull();
  });
});

describe("isInQuietHours", () => {
  // Tue 2026-04-28 12:00 UTC == 15:00 MSK (Europe/Moscow is +3 year-round)
  const noonMsk = new Date("2026-04-28T12:00:00Z");
  // 23:30 MSK
  const lateNightMsk = new Date("2026-04-28T20:30:00Z");
  // 06:30 MSK (next day in MSK)
  const earlyMorningMsk = new Date("2026-04-29T03:30:00Z");

  it("returns false outside the window", () => {
    expect(
      isInQuietHours(noonMsk, {
        from: "22:00",
        to: "07:00",
        timezone: "Europe/Moscow",
      })
    ).toBe(false);
  });

  it("returns true inside same-day window", () => {
    expect(
      isInQuietHours(noonMsk, {
        from: "10:00",
        to: "16:00",
        timezone: "Europe/Moscow",
      })
    ).toBe(true);
  });

  it("handles cross-midnight window", () => {
    expect(
      isInQuietHours(lateNightMsk, {
        from: "22:00",
        to: "07:00",
        timezone: "Europe/Moscow",
      })
    ).toBe(true);
    expect(
      isInQuietHours(earlyMorningMsk, {
        from: "22:00",
        to: "07:00",
        timezone: "Europe/Moscow",
      })
    ).toBe(true);
  });

  it("returns false when from===to (zero window)", () => {
    expect(
      isInQuietHours(noonMsk, {
        from: "12:00",
        to: "12:00",
        timezone: "Europe/Moscow",
      })
    ).toBe(false);
  });

  it("returns false when missing endpoints", () => {
    expect(
      isInQuietHours(noonMsk, {
        from: null,
        to: "07:00",
        timezone: "Europe/Moscow",
      })
    ).toBe(false);
    expect(
      isInQuietHours(noonMsk, {
        from: "22:00",
        to: null,
        timezone: "Europe/Moscow",
      })
    ).toBe(false);
  });

  it("respects weekdaysOnly flag", () => {
    // 2026-04-26 is Sunday (dow=0). 12:00 UTC = 15:00 MSK.
    const sunday = new Date("2026-04-26T12:00:00Z");
    expect(
      isInQuietHours(sunday, {
        from: "10:00",
        to: "20:00",
        timezone: "Europe/Moscow",
        weekdaysOnly: true,
      })
    ).toBe(false);
  });
});

describe("nextQuietHoursEnd", () => {
  it("schedules to next occurrence of `to`", () => {
    // 23:30 MSK → next quiet hours end at 07:00 MSK = 7.5 hours later
    const t = new Date("2026-04-28T20:30:00Z");
    const end = nextQuietHoursEnd(t, {
      from: "22:00",
      to: "07:00",
      timezone: "Europe/Moscow",
    });
    const diffH = (end.getTime() - t.getTime()) / 3_600_000;
    expect(diffH).toBeCloseTo(7.5, 1);
  });

  it("schedules ≥ 0 minutes from now", () => {
    const now = new Date();
    const end = nextQuietHoursEnd(now, {
      from: "00:00",
      to: "06:00",
      timezone: "Europe/Moscow",
    });
    expect(end.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});
