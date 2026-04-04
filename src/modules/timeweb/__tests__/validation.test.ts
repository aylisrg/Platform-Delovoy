import { describe, it, expect } from "vitest";
import {
  powerActionSchema,
  statsQuerySchema,
  logsQuerySchema,
} from "@/modules/timeweb/validation";

describe("powerActionSchema", () => {
  it("accepts 'start'", () => {
    const result = powerActionSchema.safeParse({ action: "start" });
    expect(result.success).toBe(true);
  });

  it("accepts 'shutdown'", () => {
    const result = powerActionSchema.safeParse({ action: "shutdown" });
    expect(result.success).toBe(true);
  });

  it("accepts 'reboot'", () => {
    const result = powerActionSchema.safeParse({ action: "reboot" });
    expect(result.success).toBe(true);
  });

  it("accepts 'hard-reboot'", () => {
    const result = powerActionSchema.safeParse({ action: "hard-reboot" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = powerActionSchema.safeParse({ action: "destroy" });
    expect(result.success).toBe(false);
  });

  it("rejects missing action", () => {
    const result = powerActionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string action", () => {
    const result = powerActionSchema.safeParse({ action: "" });
    expect(result.success).toBe(false);
  });
});

describe("statsQuerySchema", () => {
  it("accepts valid date range", () => {
    const result = statsQuerySchema.safeParse({
      date_from: "2025-01-01",
      date_to: "2025-01-31",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty params (all optional)", () => {
    const result = statsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts only date_from", () => {
    const result = statsQuerySchema.safeParse({ date_from: "2025-06-15" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = statsQuerySchema.safeParse({ date_from: "01/01/2025" });
    expect(result.success).toBe(false);
  });

  it("rejects partial date", () => {
    const result = statsQuerySchema.safeParse({ date_from: "2025-01" });
    expect(result.success).toBe(false);
  });
});

describe("logsQuerySchema", () => {
  it("accepts valid params", () => {
    const result = logsQuerySchema.safeParse({ limit: 50, order: "asc" });
    expect(result.success).toBe(true);
  });

  it("applies defaults for empty params", () => {
    const result = logsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
      expect(result.data.order).toBe("desc");
    }
  });

  it("coerces string limit to number", () => {
    const result = logsQuerySchema.safeParse({ limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects limit above 500", () => {
    const result = logsQuerySchema.safeParse({ limit: 501 });
    expect(result.success).toBe(false);
  });

  it("rejects limit below 1", () => {
    const result = logsQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid order", () => {
    const result = logsQuerySchema.safeParse({ order: "random" });
    expect(result.success).toBe(false);
  });
});
