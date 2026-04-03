import { describe, it, expect } from "vitest";
import {
  updateModuleConfigSchema,
  auditFilterSchema,
  analyticsQuerySchema,
  eventsFilterSchema,
} from "@/modules/monitoring/architect-validation";

describe("updateModuleConfigSchema", () => {
  it("rejects empty object (no fields)", () => {
    const result = updateModuleConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts { isActive: false }", () => {
    const result = updateModuleConfigSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(false);
  });

  it("accepts { isActive: true }", () => {
    const result = updateModuleConfigSchema.safeParse({ isActive: true });
    expect(result.success).toBe(true);
  });

  it("accepts { config: { maxBookings: 10 } }", () => {
    const result = updateModuleConfigSchema.safeParse({ config: { maxBookings: 10 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.config).toEqual({ maxBookings: 10 });
  });

  it("accepts both isActive and config together", () => {
    const result = updateModuleConfigSchema.safeParse({
      isActive: true,
      config: { key: "value" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-boolean isActive", () => {
    const result = updateModuleConfigSchema.safeParse({ isActive: "yes" });
    expect(result.success).toBe(false);
  });
});

describe("auditFilterSchema", () => {
  it("applies defaults when no params given", () => {
    const result = auditFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it("coerces string limit to number", () => {
    const result = auditFilterSchema.safeParse({ limit: "25" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(25);
  });

  it("rejects limit > 100", () => {
    const result = auditFilterSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects limit < 1", () => {
    const result = auditFilterSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts valid date strings", () => {
    const result = auditFilterSchema.safeParse({
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = auditFilterSchema.safeParse({ dateFrom: "01-01-2024" });
    expect(result.success).toBe(false);
  });

  it("passes through userId, entity, action filters", () => {
    const result = auditFilterSchema.safeParse({
      userId: "user-1",
      entity: "Booking",
      action: "booking.create",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe("user-1");
      expect(result.data.entity).toBe("Booking");
      expect(result.data.action).toBe("booking.create");
    }
  });
});

describe("analyticsQuerySchema", () => {
  it("accepts empty object", () => {
    const result = analyticsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid date range", () => {
    const result = analyticsQuerySchema.safeParse({
      dateFrom: "2024-01-01",
      dateTo: "2024-03-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = analyticsQuerySchema.safeParse({ dateTo: "31/12/2024" });
    expect(result.success).toBe(false);
  });
});

describe("eventsFilterSchema", () => {
  it("applies defaults", () => {
    const result = eventsFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it("accepts valid level", () => {
    const result = eventsFilterSchema.safeParse({ level: "ERROR" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid level", () => {
    const result = eventsFilterSchema.safeParse({ level: "DEBUG" });
    expect(result.success).toBe(false);
  });
});
