import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { module: { findUnique: vi.fn() } } }));

import {
  DEFAULT_CLEANING_BUFFER_MINUTES,
  bufferedOverlapWhere,
  isSlotBlocked,
  parseCleaningBufferMinutes,
} from "../cleaning-buffer";

const t = (d: string, hm: string) => new Date(`${d}T${hm}:00+03:00`);
const D = "2026-10-20";
const booking = { startTime: t(D, "14:00"), endTime: t(D, "16:00") };

describe("cleaning buffer (#1067)", () => {
  it("default is 60 min, configurable, 0 disables", () => {
    expect(DEFAULT_CLEANING_BUFFER_MINUTES).toBe(60);
    expect(parseCleaningBufferMinutes(null)).toBe(60);
    expect(parseCleaningBufferMinutes({ cleaningBufferMinutes: 30 })).toBe(30);
    expect(parseCleaningBufferMinutes({ cleaningBufferMinutes: 0 })).toBe(0);
    expect(parseCleaningBufferMinutes({ cleaningBufferMinutes: -5 })).toBe(60);
    expect(parseCleaningBufferMinutes({ cleaningBufferMinutes: "x" })).toBe(60);
  });

  it("blocks customer slot in the hour after a booking", () => {
    expect(isSlotBlocked(booking, t(D, "16:00"), t(D, "17:00"), 60)).toBe(true);
    expect(isSlotBlocked(booking, t(D, "17:00"), t(D, "18:00"), 60)).toBe(false);
  });

  it("blocks customer slot that leaves no cleaning time before next booking", () => {
    expect(isSlotBlocked(booking, t(D, "13:00"), t(D, "14:00"), 60)).toBe(true);
    expect(isSlotBlocked(booking, t(D, "12:00"), t(D, "13:00"), 60)).toBe(false);
  });

  it("buffer 0 keeps the old strict behaviour (admin override path)", () => {
    expect(isSlotBlocked(booking, t(D, "16:00"), t(D, "17:00"), 0)).toBe(false);
    expect(isSlotBlocked(booking, t(D, "13:00"), t(D, "14:00"), 0)).toBe(false);
    expect(isSlotBlocked(booking, t(D, "15:00"), t(D, "16:00"), 0)).toBe(true);
  });

  it("prisma overlap window widens by buffer on both sides", () => {
    const w = bufferedOverlapWhere(t(D, "17:00"), t(D, "18:00"), 60);
    expect(w.startTime.lt).toEqual(t(D, "19:00"));
    expect(w.endTime.gt).toEqual(t(D, "16:00"));
    // existing 14-16 booking: E(16:00) > 16:00 is false -> 17:00 allowed
    expect(booking.endTime > w.endTime.gt).toBe(false);
  });

  it("closing booking does not carry buffer over night", () => {
    const late = { startTime: t(D, "21:00"), endTime: t(D, "22:00") };
    expect(isSlotBlocked(late, t("2026-10-21", "11:00"), t("2026-10-21", "12:00"), 60)).toBe(false);
  });
});
