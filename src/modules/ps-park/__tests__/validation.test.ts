import { describe, it, expect } from "vitest";
import {
  createTableSchema,
  updateTableSchema,
  createPSBookingSchema,
  psBookingFilterSchema,
  adminCreatePSBookingSchema,
  addBookingItemsSchema,
  timelineQuerySchema,
  analyticsQuerySchema,
  moduleSettingsSchema,
  PS_PARK_CHANNEL_EVENT_TYPES,
} from "@/modules/ps-park/validation";

describe("PS Park Telegram-канал", () => {
  it("PS_PARK_CHANNEL_EVENT_TYPES содержит booking.paid и не содержит booking.created", () => {
    const types = PS_PARK_CHANNEL_EVENT_TYPES as readonly string[];
    expect(types).toContain("booking.paid");
    expect(types).not.toContain("booking.created");
  });

  it("moduleSettingsSchema принимает telegramChannel* поля", () => {
    const parsed = moduleSettingsSchema.safeParse({
      telegramChannelEnabled: true,
      telegramChannelName: "Плей Парк",
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid", "booking.completed"],
    });
    expect(parsed.success).toBe(true);
  });

  it("moduleSettingsSchema отклоняет неизвестный тип события", () => {
    const parsed = moduleSettingsSchema.safeParse({
      telegramChannelEvents: ["booking.created"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("createTableSchema", () => {
  it("accepts valid input with name only", () => {
    const result = createTableSchema.safeParse({ name: "PlayStation стол №1" });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = createTableSchema.safeParse({
      name: "PlayStation стол №2",
      description: "Стол с PS5",
      capacity: 4,
      pricePerHour: 350,
      metadata: { consoles: ["PS5"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createTableSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects zero capacity", () => {
    const result = createTableSchema.safeParse({ name: "Стол", capacity: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative pricePerHour", () => {
    const result = createTableSchema.safeParse({ name: "Стол", pricePerHour: -100 });
    expect(result.success).toBe(false);
  });
});

describe("updateTableSchema", () => {
  it("accepts empty object", () => {
    const result = updateTableSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts isActive toggle", () => {
    const result = updateTableSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });
});

describe("createPSBookingSchema", () => {
  const validInput = {
    resourceId: "table-1",
    date: "2030-08-20",
    startTime: "14:00",
    endTime: "16:00",
  };

  it("accepts valid booking input", () => {
    const result = createPSBookingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts booking with playerCount and comment", () => {
    const result = createPSBookingSchema.safeParse({
      ...validInput,
      playerCount: 2,
      comment: "Финал турнира",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when endTime is before startTime (refine)", () => {
    const result = createPSBookingSchema.safeParse({
      ...validInput,
      startTime: "16:00",
      endTime: "14:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("endTime"))).toBe(true);
    }
  });

  it("rejects equal startTime and endTime", () => {
    const result = createPSBookingSchema.safeParse({
      ...validInput,
      startTime: "14:00",
      endTime: "14:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = createPSBookingSchema.safeParse({ ...validInput, date: "20-08-2030" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format", () => {
    const result = createPSBookingSchema.safeParse({ ...validInput, endTime: "4pm" });
    expect(result.success).toBe(false);
  });

  it("rejects missing resourceId", () => {
    const { resourceId: _resourceId, ...rest } = validInput;
    const result = createPSBookingSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("adminCreatePSBookingSchema", () => {
  const validBase = {
    resourceId: "table-1",
    date: "2030-08-20",
    startTime: "14:00",
    endTime: "16:00",
    clientName: "Иван Петров",
  };

  it("accepts valid input with name only (no phone)", () => {
    const result = adminCreatePSBookingSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("accepts valid input with optional phone", () => {
    const result = adminCreatePSBookingSchema.safeParse({ ...validBase, clientPhone: "+79001234567" });
    expect(result.success).toBe(true);
  });

  it("rejects empty clientName", () => {
    const result = adminCreatePSBookingSchema.safeParse({ ...validBase, clientName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty string for clientPhone when provided", () => {
    const result = adminCreatePSBookingSchema.safeParse({ ...validBase, clientPhone: "" });
    expect(result.success).toBe(false);
  });
});

describe("addBookingItemsSchema", () => {
  it("accepts valid items array", () => {
    const result = addBookingItemsSchema.safeParse({
      items: [{ skuId: "sku-1", quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty items array", () => {
    const result = addBookingItemsSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing items field", () => {
    const result = addBookingItemsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const result = addBookingItemsSchema.safeParse({
      items: [{ skuId: "sku-1", quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("timelineQuerySchema", () => {
  it("accepts valid date", () => {
    const result = timelineQuerySchema.safeParse({ date: "2030-08-20" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = timelineQuerySchema.safeParse({ date: "20/08/2030" });
    expect(result.success).toBe(false);
  });

  it("rejects missing date", () => {
    const result = timelineQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = timelineQuerySchema.safeParse({ date: "" });
    expect(result.success).toBe(false);
  });
});

describe("psBookingFilterSchema", () => {
  it("accepts empty filter", () => {
    const result = psBookingFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid PENDING status", () => {
    const result = psBookingFilterSchema.safeParse({ status: "PENDING" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status value", () => {
    const result = psBookingFilterSchema.safeParse({ status: "WAITING" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed dateFrom", () => {
    const result = psBookingFilterSchema.safeParse({ dateFrom: "2030/08/20" });
    expect(result.success).toBe(false);
  });

  // #431: Zod молча отбрасывала page/perPage (не было в схеме), поэтому UI
  // всегда получал одну и ту же страницу через хардкод take:100.
  it("defaults page to 1 and perPage to 20 when absent", () => {
    const result = psBookingFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.perPage).toBe(20);
    }
  });

  it("coerces page/perPage from query-string values", () => {
    const result = psBookingFilterSchema.safeParse({ page: "3", perPage: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.perPage).toBe(50);
    }
  });

  it("rejects perPage above the cap", () => {
    const result = psBookingFilterSchema.safeParse({ perPage: "500" });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive page", () => {
    const result = psBookingFilterSchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  // #438: поиск по имени/телефону гостя в истории броней.
  it("accepts a search string", () => {
    const result = psBookingFilterSchema.safeParse({ search: "Петров" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("Петров");
    }
  });

  it("rejects a search string over 200 characters", () => {
    const result = psBookingFilterSchema.safeParse({ search: "a".repeat(201) });
    expect(result.success).toBe(false);
  });
});

describe("analyticsQuerySchema", () => {
  it("accepts week period", () => {
    expect(analyticsQuerySchema.safeParse({ period: "week" }).success).toBe(true);
  });

  it("accepts month period", () => {
    expect(analyticsQuerySchema.safeParse({ period: "month" }).success).toBe(true);
  });

  it("defaults to month", () => {
    const result = analyticsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.period).toBe("month");
  });

  it("rejects invalid period", () => {
    expect(analyticsQuerySchema.safeParse({ period: "year" }).success).toBe(false);
  });
});

describe("moduleSettingsSchema", () => {
  it("accepts valid settings", () => {
    const result = moduleSettingsSchema.safeParse({
      openHour: 8,
      closeHour: 23,
      minBookingHours: 1,
      slotRoundingMinutes: 30,
      sessionAlertMinutes: 10,
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial settings", () => {
    expect(moduleSettingsSchema.safeParse({ openHour: 9 }).success).toBe(true);
  });

  it("rejects invalid slotRoundingMinutes", () => {
    expect(moduleSettingsSchema.safeParse({ slotRoundingMinutes: 0 }).success).toBe(false);
  });

  it("rejects sessionAlertMinutes > 60", () => {
    expect(moduleSettingsSchema.safeParse({ sessionAlertMinutes: 61 }).success).toBe(false);
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
    expect(moduleSettingsSchema.safeParse({ noShowThresholdMinutes: 0 }).success).toBe(false);
  });
});
