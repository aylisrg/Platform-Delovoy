import { describe, it, expect } from "vitest";
import {
  parseHHMM,
  formatHHMM,
  durationMinutes,
  durationLabel,
  billedHours,
  endTimeFromDuration,
  maxDurationMin,
  selectedChip,
  generateHalfHourSlots,
  getMaxEndFromBookings,
  isSlotFree,
  DURATION_CHIPS_MIN,
} from "../booking-time";

describe("booking-time helpers", () => {
  describe("parseHHMM / formatHHMM", () => {
    it("parses HH:MM to minutes", () => {
      expect(parseHHMM("08:00")).toBe(480);
      expect(parseHHMM("09:30")).toBe(570);
      expect(parseHHMM("23:00")).toBe(1380);
    });

    it("formats minutes back to HH:MM with leading zeros", () => {
      expect(formatHHMM(480)).toBe("08:00");
      expect(formatHHMM(570)).toBe("09:30");
      expect(formatHHMM(0)).toBe("00:00");
    });

    it("formatHHMM clamps out-of-range values", () => {
      expect(formatHHMM(-10)).toBe("00:00");
      expect(formatHHMM(60 * 25)).toBe("24:00");
    });
  });

  describe("durationMinutes / durationLabel", () => {
    it("returns positive duration", () => {
      expect(durationMinutes("15:00", "16:30")).toBe(90);
    });

    it("returns negative duration for inverted order", () => {
      expect(durationMinutes("16:00", "15:00")).toBe(-60);
    });

    it("labels hours and minutes correctly", () => {
      expect(durationLabel("15:00", "16:00")).toBe("1ч");
      expect(durationLabel("15:00", "15:30")).toBe("30мин");
      expect(durationLabel("15:00", "16:30")).toBe("1ч 30мин");
      expect(durationLabel("16:00", "15:00")).toBe("—");
    });
  });

  describe("billedHours", () => {
    it("rounds up to nearest 30 min increment in hours", () => {
      expect(billedHours("15:00", "15:30")).toBe(0.5);
      expect(billedHours("15:00", "15:45")).toBe(1);
      expect(billedHours("15:00", "16:00")).toBe(1);
      expect(billedHours("15:00", "16:10")).toBe(1.5);
      expect(billedHours("15:00", "17:30")).toBe(2.5);
    });

    it("returns 0 for non-positive durations", () => {
      expect(billedHours("16:00", "15:00")).toBe(0);
      expect(billedHours("15:00", "15:00")).toBe(0);
    });
  });

  describe("endTimeFromDuration", () => {
    it("adds duration in minutes to start time", () => {
      expect(endTimeFromDuration("15:00", 60)).toBe("16:00");
      expect(endTimeFromDuration("15:00", 90)).toBe("16:30");
    });

    it("clamps to maxEndHHMM when provided", () => {
      expect(endTimeFromDuration("15:00", 240, "16:00")).toBe("16:00");
    });

    it("clamps to CLOSE_HHMM (23:00) when no max specified", () => {
      expect(endTimeFromDuration("22:00", 240)).toBe("23:00");
    });

    it("clamps to CLOSE when max is after close", () => {
      expect(endTimeFromDuration("22:30", 60, "23:30")).toBe("23:00");
    });
  });

  describe("maxDurationMin", () => {
    it("returns minutes until maxEnd when within open hours", () => {
      expect(maxDurationMin("15:00", "17:00")).toBe(120);
    });

    it("returns 0 if max <= start", () => {
      expect(maxDurationMin("15:00", "15:00")).toBe(0);
      expect(maxDurationMin("15:00", "14:00")).toBe(0);
    });

    it("caps at CLOSE_HHMM", () => {
      expect(maxDurationMin("22:00", "23:30")).toBe(60);
    });
  });

  describe("selectedChip", () => {
    it("returns duration when it matches a chip", () => {
      expect(selectedChip("15:00", "16:00")).toBe(60);
      expect(selectedChip("15:00", "15:30")).toBe(30);
      expect(selectedChip("15:00", "18:00")).toBe(180);
    });

    it("returns null for non-chip durations", () => {
      expect(selectedChip("15:00", "16:20")).toBeNull();
      expect(selectedChip("15:00", "19:15")).toBeNull();
    });

    it("respects DURATION_CHIPS_MIN set", () => {
      expect(DURATION_CHIPS_MIN).toContain(60);
      expect(DURATION_CHIPS_MIN).toContain(120);
      expect(DURATION_CHIPS_MIN).not.toContain(75);
    });
  });

  describe("generateHalfHourSlots", () => {
    it("generates 30-minute slots between open and close", () => {
      const slots = generateHalfHourSlots("08:00", "09:30");
      expect(slots).toEqual(["08:00", "08:30", "09:00"]);
    });

    it("defaults to 8:00-23:00 — 30 slots", () => {
      const slots = generateHalfHourSlots();
      expect(slots[0]).toBe("08:00");
      expect(slots[slots.length - 1]).toBe("22:30");
      expect(slots.length).toBe(30);
    });
  });

  describe("getMaxEndFromBookings", () => {
    const bookings = [
      { startHHMM: "10:00", endHHMM: "12:00" },
      { startHHMM: "14:00", endHHMM: "15:30" },
      { startHHMM: "18:00", endHHMM: "19:00" },
    ];

    it("returns earliest next booking start after slot", () => {
      expect(getMaxEndFromBookings("09:00", bookings)).toBe("10:00");
      expect(getMaxEndFromBookings("13:00", bookings)).toBe("14:00");
    });

    it("ignores bookings that start before or at slot", () => {
      expect(getMaxEndFromBookings("15:30", bookings)).toBe("18:00");
    });

    it("returns CLOSE_HHMM if no later bookings", () => {
      expect(getMaxEndFromBookings("20:00", bookings)).toBe("23:00");
      expect(getMaxEndFromBookings("15:00", [])).toBe("23:00");
    });
  });

  describe("isSlotFree", () => {
    const bookings = [
      { startHHMM: "10:00", endHHMM: "11:30" },
      { startHHMM: "14:00", endHHMM: "15:00" },
    ];

    it("returns true for slots outside bookings", () => {
      expect(isSlotFree("08:00", bookings)).toBe(true);
      expect(isSlotFree("12:00", bookings)).toBe(true);
      expect(isSlotFree("15:00", bookings)).toBe(true); // just after
    });

    it("returns false for slots overlapping bookings", () => {
      expect(isSlotFree("10:00", bookings)).toBe(false);
      expect(isSlotFree("10:30", bookings)).toBe(false);
      expect(isSlotFree("11:00", bookings)).toBe(false); // partial overlap
    });

    it("treats booking end as exclusive", () => {
      expect(isSlotFree("11:30", bookings)).toBe(true);
    });

    it("treats empty bookings as all free", () => {
      expect(isSlotFree("12:00", [])).toBe(true);
    });
  });
});
