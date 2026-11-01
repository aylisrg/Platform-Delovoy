import { describe, it, expect } from "vitest";
import {
  updatePreferenceSchema,
  historyFilterSchema,
  statsPeriodSchema,
  notificationStatsQuerySchema,
} from "../validation";

describe("updatePreferenceSchema", () => {
  it("accepts valid preference update", () => {
    const result = updatePreferenceSchema.safeParse({
      preferredChannel: "TELEGRAM",
      enableBooking: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updatePreferenceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid channel", () => {
    const result = updatePreferenceSchema.safeParse({
      preferredChannel: "SMS",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid channels", () => {
    for (const ch of ["AUTO", "TELEGRAM", "EMAIL", "VK"]) {
      const result = updatePreferenceSchema.safeParse({ preferredChannel: ch });
      expect(result.success, `${ch} should be valid`).toBe(true);
    }
  });
});

describe("historyFilterSchema", () => {
  it("defaults page to 1 and limit to 20", () => {
    const result = historyFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("accepts valid filter", () => {
    const result = historyFilterSchema.safeParse({
      page: "2",
      limit: "50",
      moduleSlug: "cafe",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects limit above 100", () => {
    const result = historyFilterSchema.safeParse({ limit: "200" });
    expect(result.success).toBe(false);
  });
});

describe("statsPeriodSchema (ADR 2026-10-25 §6.2)", () => {
  it("AC-D1.1: period defaults to 30 days", () => {
    expect(statsPeriodSchema.parse({})).toEqual({ period: 30 });
  });

  it("AC-D1.1: accepts 7 / 30 / 90 from the query string", () => {
    expect(statsPeriodSchema.parse({ period: "7" }).period).toBe(7);
    expect(statsPeriodSchema.parse({ period: "30" }).period).toBe(30);
    expect(statsPeriodSchema.parse({ period: "90" }).period).toBe(90);
  });

  it.each(["14", "0", "", "abc", "-7", "7.5"])("rejects period=%j", (period) => {
    const result = statsPeriodSchema.safeParse({ period });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Период — 7, 30 или 90 дней");
  });
});

describe("notificationStatsQuerySchema (ADR 2026-10-25 §6.2)", () => {
  it("accepts the slices: catalog event, catalog category, user id, stats channel", () => {
    const result = notificationStatsQuerySchema.parse({
      period: "90",
      eventType: "booking.created",
      category: "bookings",
      userId: "cuid123",
      channel: "IN_APP",
    });
    expect(result).toEqual({ period: 90, eventType: "booking.created", category: "bookings", userId: "cuid123", channel: "IN_APP" });
  });

  it("rejects event types outside the catalog, unknown categories and channels", () => {
    expect(notificationStatsQuerySchema.safeParse({ eventType: "booking.reminder" }).success).toBe(false);
    expect(notificationStatsQuerySchema.safeParse({ category: "nope" }).success).toBe(false);
    expect(notificationStatsQuerySchema.safeParse({ channel: "VK" }).success).toBe(false);
    expect(notificationStatsQuerySchema.safeParse({ userId: "x".repeat(65) }).success).toBe(false);
  });
});
