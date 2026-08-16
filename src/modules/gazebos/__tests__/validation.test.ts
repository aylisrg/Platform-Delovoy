import { describe, it, expect } from "vitest";
import {
  createResourceSchema,
  updateResourceSchema,
  createBookingSchema,
  bookingFilterSchema,
  adminCreateBookingSchema,
  rescheduleBookingSchema,
  timelineQuerySchema,
  analyticsQuerySchema,
  moduleSettingsSchema,
  GAZEBO_CHANNEL_EVENT_TYPES,
} from "@/modules/gazebos/validation";

describe("GAZEBO_CHANNEL_EVENT_TYPES", () => {
  it("канал шлёт booking.paid, а booking.created/confirmed исключены", () => {
    const types = GAZEBO_CHANNEL_EVENT_TYPES as readonly string[];
    expect(types).toContain("booking.paid");
    expect(types).not.toContain("booking.created");
    expect(types).not.toContain("booking.confirmed");
  });

  it("moduleSettingsSchema принимает telegramChannelEvents с booking.paid", () => {
    const parsed = moduleSettingsSchema.safeParse({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid", "booking.cancelled"],
    });
    expect(parsed.success).toBe(true);
  });

  it("moduleSettingsSchema отклоняет устаревший booking.created", () => {
    const parsed = moduleSettingsSchema.safeParse({
      telegramChannelEvents: ["booking.created"],
    });
    expect(parsed.success).toBe(false);
  });
});

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

  // #431: Zod молча отбрасывала page/perPage (не было в схеме), поэтому UI
  // всегда получал одну и ту же страницу через хардкод take:100.
  it("defaults page to 1 and perPage to 20 when absent", () => {
    const result = bookingFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.perPage).toBe(20);
    }
  });

  it("coerces page/perPage from query-string values", () => {
    const result = bookingFilterSchema.safeParse({ page: "3", perPage: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.perPage).toBe(50);
    }
  });

  it("rejects perPage above the cap", () => {
    const result = bookingFilterSchema.safeParse({ perPage: "500" });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive page", () => {
    const result = bookingFilterSchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  // #438: поиск по имени/телефону гостя в истории броней.
  it("accepts a search string", () => {
    const result = bookingFilterSchema.safeParse({ search: "Иванов" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("Иванов");
    }
  });

  it("rejects a search string over 200 characters", () => {
    const result = bookingFilterSchema.safeParse({ search: "a".repeat(201) });
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

  it("accepts a valid optional email (issue #665)", () => {
    const result = adminCreateBookingSchema.safeParse({ ...validInput, email: "guest@example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email (issue #665)", () => {
    const result = adminCreateBookingSchema.safeParse({ ...validInput, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts input without email — optional (issue #665)", () => {
    const result = adminCreateBookingSchema.safeParse(validInput);
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

  // #440: порог неявки был захардкожен `30` в сервисе — настройка не была
  // валидируемым полем формы вообще.
  it("accepts noShowThresholdMinutes", () => {
    const result = moduleSettingsSchema.safeParse({ noShowThresholdMinutes: 15 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.noShowThresholdMinutes).toBe(15);
    }
  });

  it("rejects non-positive noShowThresholdMinutes", () => {
    const result = moduleSettingsSchema.safeParse({ noShowThresholdMinutes: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts Telegram channel settings", () => {
    const result = moduleSettingsSchema.safeParse({
      telegramChannelEnabled: true,
      telegramChannelName: "Беседки",
      telegramChannelId: "-1001234567890",
      telegramChannelEvents: ["booking.paid", "booking.deleted"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty telegramChannelId (clears the channel)", () => {
    const result = moduleSettingsSchema.safeParse({ telegramChannelId: "" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown channel event type", () => {
    const result = moduleSettingsSchema.safeParse({
      telegramChannelEvents: ["booking.created", "order.placed"],
    });
    expect(result.success).toBe(false);
  });
});

describe("rescheduleBookingSchema", () => {
  it("accepts a time-only change", () => {
    const result = rescheduleBookingSchema.safeParse({
      startTime: "12:00",
      endTime: "16:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a client-only change", () => {
    const result = rescheduleBookingSchema.safeParse({ clientName: "Пётр" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty payload (no changes)", () => {
    const result = rescheduleBookingSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects start >= end when both are given", () => {
    const result = rescheduleBookingSchema.safeParse({
      startTime: "16:00",
      endTime: "12:00",
    });
    expect(result.success).toBe(false);
  });
});

describe("moduleSettingsSchema publicBookingEnabled", () => {
  it("accepts the publicBookingEnabled toggle", () => {
    expect(moduleSettingsSchema.safeParse({ publicBookingEnabled: false }).success).toBe(true);
    expect(moduleSettingsSchema.safeParse({ publicBookingEnabled: true }).success).toBe(true);
  });
});

describe("GAZEBO_CHANNEL_EVENT_TYPES ending_soon", () => {
  it("includes booking.ending_soon for the extension prompt", () => {
    expect((GAZEBO_CHANNEL_EVENT_TYPES as readonly string[])).toContain(
      "booking.ending_soon"
    );
  });
});
