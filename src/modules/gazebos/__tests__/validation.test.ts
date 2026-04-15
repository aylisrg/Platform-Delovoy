import { describe, it, expect } from "vitest";
import {
  createResourceSchema,
  updateResourceSchema,
  createBookingSchema,
  bookingFilterSchema,
  adminCreateBookingSchema,
  timelineQuerySchema,
  analyticsQuerySchema,
  moduleSettingsSchema,
} from "@/modules/gazebos/validation";

describe("createResourceSchema", () => {
  it("accepts valid input with required fields only", () => {
    const result = createResourceSchema.safeParse({ name: "Беседка №1" });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = createResourceSchema.safeParse({
      name: "Беседка №2",
      description: "Уютная беседка",
      capacity: 8,
      pricePerHour: 500,
      metadata: { hasBBQ: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createResourceSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects negative capacity", () => {
    const result = createResourceSchema.safeParse({ name: "Беседка", capacity: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero pricePerHour", () => {
    const result = createResourceSchema.safeParse({ name: "Беседка", pricePerHour: 0 });
    expect(result.success).toBe(false);
  });
});

describe("updateResourceSchema", () => {
  it("accepts empty object (all optional)", () => {
    const result = updateResourceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts isActive toggle", () => {
    const result = updateResourceSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });
});

describe("createBookingSchema", () => {
  const validInput = {
    resourceId: "resource-1",
    date: "2030-06-15",
    startTime: "10:00",
    endTime: "11:00",
  };

  it("accepts valid booking input", () => {
    const result = createBookingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts booking with optional guestCount and comment", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      guestCount: 4,
      comment: "День рождения",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when endTime is before startTime (refine)", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      startTime: "12:00",
      endTime: "10:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("endTime"))).toBe(true);
    }
  });

  it("rejects when endTime equals startTime", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      startTime: "10:00",
      endTime: "10:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = createBookingSchema.safeParse({ ...validInput, date: "15-06-2030" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format", () => {
    const result = createBookingSchema.safeParse({ ...validInput, startTime: "10:00 AM" });
    expect(result.success).toBe(false);
  });

  it("rejects missing resourceId", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resourceId: _resourceId, ...rest } = validInput;
    const result = createBookingSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("bookingFilterSchema", () => {
  it("accepts empty filter", () => {
    const result = bookingFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid status", () => {
    const result = bookingFilterSchema.safeParse({ status: "CONFIRMED" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = bookingFilterSchema.safeParse({ status: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects wrong date format in dateFrom", () => {
    const result = bookingFilterSchema.safeParse({ dateFrom: "15/06/2030" });
    expect(result.success).toBe(false);
  });
});

describe("adminCreateBookingSchema", () => {
  const validInput = {
    resourceId: "resource-1",
    date: "2030-06-15",
    startTime: "10:00",
    endTime: "12:00",
    clientName: "Иванов Иван",
    clientPhone: "+7 999 123-45-67",
  };

  it("accepts valid admin booking input", () => {
    const result = adminCreateBookingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("requires clientName", () => {
    const result = adminCreateBookingSchema.safeParse({ ...validInput, clientName: "" });
    expect(result.success).toBe(false);
  });

  it("requires clientPhone", () => {
    const result = adminCreateBookingSchema.safeParse({ ...validInput, clientPhone: "" });
    expect(result.success).toBe(false);
  });

  it("rejects if startTime >= endTime", () => {
    const result = adminCreateBookingSchema.safeParse({ ...validInput, startTime: "14:00", endTime: "12:00" });
    expect(result.success).toBe(false);
  });

  it("accepts optional guestCount and comment", () => {
    const result = adminCreateBookingSchema.safeParse({
      ...validInput,
      guestCount: 5,
      comment: "VIP",
    });
    expect(result.success).toBe(true);
  });
});

describe("timelineQuerySchema", () => {
  it("accepts valid date", () => {
    const result = timelineQuerySchema.safeParse({ date: "2026-04-14" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = timelineQuerySchema.safeParse({ date: "14-04-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects empty date", () => {
    const result = timelineQuerySchema.safeParse({ date: "" });
    expect(result.success).toBe(false);
  });
});

describe("analyticsQuerySchema", () => {
  it("accepts week period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "week" });
    expect(result.success).toBe(true);
  });

  it("accepts month period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "month" });
    expect(result.success).toBe(true);
  });

  it("accepts quarter period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "quarter" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "year" });
    expect(result.success).toBe(false);
  });

  it("defaults to month when no period given", () => {
    const result = analyticsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe("month");
    }
  });
});

describe("moduleSettingsSchema", () => {
  it("accepts valid settings", () => {
    const result = moduleSettingsSchema.safeParse({
      openHour: 8,
      closeHour: 23,
      minBookingHours: 1,
      maxBookingHours: 8,
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial settings (all optional)", () => {
    const result = moduleSettingsSchema.safeParse({ openHour: 9 });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = moduleSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects openHour > 23", () => {
    const result = moduleSettingsSchema.safeParse({ openHour: 25 });
    expect(result.success).toBe(false);
  });

  it("rejects negative minBookingHours", () => {
    const result = moduleSettingsSchema.safeParse({ minBookingHours: 0 });
    expect(result.success).toBe(false);
  });
});
