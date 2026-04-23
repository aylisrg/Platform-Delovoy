import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatTime,
  formatDateTime,
  parseDate,
  toISODate,
  toISODateTimeLocal,
  getMoscowHour,
  TZ,
} from "../format";

describe("format.ts — unified date/time formatting", () => {
  describe("formatDate", () => {
    it("formats ISO string as дд-мм-гггг (Moscow TZ)", () => {
      // 23 April 2026 09:00 Moscow = 06:00 UTC
      expect(formatDate("2026-04-23T06:00:00.000Z")).toBe("23-04-2026");
    });

    it("respects Moscow TZ: UTC 23:30 on 22 Apr → 02:30 Moscow on 23 Apr", () => {
      expect(formatDate("2026-04-22T23:30:00.000Z")).toBe("23-04-2026");
    });

    it("accepts Date instance", () => {
      expect(formatDate(new Date("2026-01-05T12:00:00.000Z"))).toBe("05-01-2026");
    });

    it("accepts epoch ms", () => {
      const ms = Date.UTC(2026, 0, 5, 12, 0, 0);
      expect(formatDate(ms)).toBe("05-01-2026");
    });

    it("returns empty string for null/undefined/empty/invalid", () => {
      expect(formatDate(null)).toBe("");
      expect(formatDate(undefined)).toBe("");
      expect(formatDate("")).toBe("");
      expect(formatDate("not a date")).toBe("");
    });

    it("zero-pads day and month", () => {
      expect(formatDate("2026-01-05T10:00:00.000Z")).toBe("05-01-2026");
    });
  });

  describe("formatTime", () => {
    it("formats as 24h HH:mm in Moscow TZ (UTC+3)", () => {
      // 06:00 UTC → 09:00 Moscow
      expect(formatTime("2026-04-23T06:00:00.000Z")).toBe("09:00");
    });

    it("formats midnight correctly (no '24:00' bug)", () => {
      // 21:00 UTC → 00:00 next day Moscow
      expect(formatTime("2026-04-23T21:00:00.000Z")).toBe("00:00");
    });

    it("handles half-hour", () => {
      expect(formatTime("2026-04-23T15:30:00.000Z")).toBe("18:30");
    });

    it("returns empty string for null/invalid", () => {
      expect(formatTime(null)).toBe("");
      expect(formatTime(undefined)).toBe("");
      expect(formatTime("garbage")).toBe("");
    });
  });

  describe("formatDateTime", () => {
    it("combines date and time with space separator", () => {
      expect(formatDateTime("2026-04-23T15:30:00.000Z")).toBe("23-04-2026 18:30");
    });

    it("returns empty string for null", () => {
      expect(formatDateTime(null)).toBe("");
    });
  });

  describe("parseDate", () => {
    it("parses valid дд-мм-гггг into Moscow-midnight Date", () => {
      const d = parseDate("23-04-2026");
      // Moscow midnight 23 Apr = 21:00 UTC on 22 Apr (UTC+3, no DST)
      expect(d.toISOString()).toBe("2026-04-22T21:00:00.000Z");
    });

    it("round-trips through formatDate", () => {
      expect(formatDate(parseDate("01-01-2026"))).toBe("01-01-2026");
      expect(formatDate(parseDate("31-12-2026"))).toBe("31-12-2026");
      expect(formatDate(parseDate("29-02-2024"))).toBe("29-02-2024"); // leap
    });

    it("trims whitespace", () => {
      expect(formatDate(parseDate("  05-07-2026  "))).toBe("05-07-2026");
    });

    it("throws on non-string", () => {
      // @ts-expect-error — testing runtime guard against null
      expect(() => parseDate(null)).toThrow();
      // @ts-expect-error — testing runtime guard against number
      expect(() => parseDate(123)).toThrow();
    });

    it("throws on malformed strings", () => {
      expect(() => parseDate("2026-04-23")).toThrow(); // ISO, not our format
      expect(() => parseDate("23.04.2026")).toThrow();
      expect(() => parseDate("23/04/2026")).toThrow();
      expect(() => parseDate("3-4-2026")).toThrow(); // no leading zeros
      expect(() => parseDate("")).toThrow();
    });

    it("throws on out-of-range month/day", () => {
      expect(() => parseDate("32-01-2026")).toThrow();
      expect(() => parseDate("15-13-2026")).toThrow();
      expect(() => parseDate("00-04-2026")).toThrow();
    });

    it("throws on invalid calendar dates (31 feb)", () => {
      expect(() => parseDate("31-02-2026")).toThrow();
      expect(() => parseDate("29-02-2025")).toThrow(); // non-leap
    });
  });

  describe("toISODate / toISODateTimeLocal", () => {
    it("toISODate returns YYYY-MM-DD in Moscow TZ", () => {
      expect(toISODate("2026-04-23T06:00:00.000Z")).toBe("2026-04-23");
    });

    it("toISODateTimeLocal returns YYYY-MM-DDTHH:mm in Moscow TZ", () => {
      expect(toISODateTimeLocal("2026-04-23T06:00:00.000Z")).toBe("2026-04-23T09:00");
    });

    it("return empty string for null", () => {
      expect(toISODate(null)).toBe("");
      expect(toISODateTimeLocal(null)).toBe("");
    });
  });

  describe("getMoscowHour", () => {
    it("returns hour 0..23 in Moscow TZ", () => {
      expect(getMoscowHour("2026-04-23T06:00:00.000Z")).toBe(9);
      expect(getMoscowHour("2026-04-23T21:00:00.000Z")).toBe(0); // midnight next day
      expect(getMoscowHour("2026-04-23T20:30:00.000Z")).toBe(23);
    });

    it("returns NaN for null/invalid", () => {
      expect(getMoscowHour(null)).toBeNaN();
      expect(getMoscowHour("nope")).toBeNaN();
    });
  });

  describe("DST / historical edges", () => {
    it("Moscow stays UTC+3 year-round (no DST since 2011)", () => {
      // Winter
      expect(formatTime("2026-01-15T12:00:00.000Z")).toBe("15:00");
      // Summer (old "DST" would be UTC+4; we expect UTC+3)
      expect(formatTime("2026-07-15T12:00:00.000Z")).toBe("15:00");
    });

    it("parseDate works for winter and summer dates identically", () => {
      expect(parseDate("15-01-2026").toISOString()).toBe("2026-01-14T21:00:00.000Z");
      expect(parseDate("15-07-2026").toISOString()).toBe("2026-07-14T21:00:00.000Z");
    });
  });

  describe("TZ constant", () => {
    it("exports Europe/Moscow", () => {
      expect(TZ).toBe("Europe/Moscow");
    });
  });
});
