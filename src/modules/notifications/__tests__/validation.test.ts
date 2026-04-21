import { describe, it, expect } from "vitest";
import { updatePreferenceSchema, historyFilterSchema } from "../validation";

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
