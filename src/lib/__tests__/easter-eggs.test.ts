import { describe, it, expect } from "vitest";
import {
  pickRandom,
  TOAST_BOOKING_SUCCESS,
  TOAST_BOOKING_CANCEL,
  TOAST_PS_BOOKING_SUCCESS,
  EMPTY_PS_TABLES,
  EMPTY_GAZEBOS_PUBLIC,
  EMPTY_GAZEBO_BOOKINGS_ADMIN,
  EMPTY_PS_HISTORY_ADMIN,
  EMPTY_CAFE_ORDERS_ADMIN,
  EMPTY_MONITORING_EVENTS,
  EMPTY_AUDIT_LOG,
  EMPTY_SYSTEM_MAP,
  ERROR_404_MEME,
  ERROR_500_MEME,
  ERROR_403_MEME,
  SIDEBAR_TOOLTIP,
} from "../easter-eggs";

describe("pickRandom", () => {
  it("returns an element from the array", () => {
    const arr = ["a", "b", "c"];
    const result = pickRandom(arr);
    expect(arr).toContain(result);
  });

  it("returns the only element when array has one item", () => {
    expect(pickRandom(["only"])).toBe("only");
  });

  it("always returns a defined value for non-empty arrays", () => {
    for (let i = 0; i < 20; i++) {
      const result = pickRandom([1, 2, 3, 4, 5]);
      expect(result).toBeDefined();
    }
  });
});

describe("toast pools are non-empty arrays of strings", () => {
  it("TOAST_BOOKING_SUCCESS has 4+ variants", () => {
    expect(TOAST_BOOKING_SUCCESS.length).toBeGreaterThanOrEqual(4);
    TOAST_BOOKING_SUCCESS.forEach((s) => expect(typeof s).toBe("string"));
  });

  it("TOAST_BOOKING_CANCEL has 3+ variants", () => {
    expect(TOAST_BOOKING_CANCEL.length).toBeGreaterThanOrEqual(3);
    TOAST_BOOKING_CANCEL.forEach((s) => expect(typeof s).toBe("string"));
  });

  it("TOAST_PS_BOOKING_SUCCESS has 4+ variants", () => {
    expect(TOAST_PS_BOOKING_SUCCESS.length).toBeGreaterThanOrEqual(4);
    TOAST_PS_BOOKING_SUCCESS.forEach((s) => expect(typeof s).toBe("string"));
  });
});

describe("static empty state strings are non-empty", () => {
  const statics = [
    EMPTY_PS_TABLES,
    EMPTY_GAZEBOS_PUBLIC,
    EMPTY_GAZEBO_BOOKINGS_ADMIN,
    EMPTY_PS_HISTORY_ADMIN,
    EMPTY_CAFE_ORDERS_ADMIN,
    EMPTY_MONITORING_EVENTS,
    EMPTY_AUDIT_LOG,
    EMPTY_SYSTEM_MAP,
    ERROR_404_MEME,
    ERROR_500_MEME,
    ERROR_403_MEME,
    SIDEBAR_TOOLTIP,
  ];

  it("all static strings are non-empty", () => {
    statics.forEach((s) => {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    });
  });
});
