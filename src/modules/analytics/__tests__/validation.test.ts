import { describe, it, expect } from "vitest";
import { analyticsQuerySchema } from "../validation";

describe("analyticsQuerySchema", () => {
  it("accepts valid period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "7d" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object with defaults", () => {
    const result = analyticsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forceRefresh).toBe(false);
    }
  });

  it("accepts custom date range", () => {
    const result = analyticsQuerySchema.safeParse({
      dateFrom: "2026-04-01",
      dateTo: "2026-04-10",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = analyticsQuerySchema.safeParse({ dateFrom: "01-04-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects dateFrom > dateTo", () => {
    const result = analyticsQuerySchema.safeParse({
      dateFrom: "2026-04-15",
      dateTo: "2026-04-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects future dates", () => {
    const result = analyticsQuerySchema.safeParse({
      dateTo: "2099-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("parses forceRefresh string 'true' to boolean", () => {
    const result = analyticsQuerySchema.safeParse({ forceRefresh: "true" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forceRefresh).toBe(true);
    }
  });

  it("rejects invalid period", () => {
    const result = analyticsQuerySchema.safeParse({ period: "90d" });
    expect(result.success).toBe(false);
  });
});
