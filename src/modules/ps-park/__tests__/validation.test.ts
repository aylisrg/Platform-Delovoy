import { describe, it, expect } from "vitest";
import {
  createTableSchema,
  updateTableSchema,
  createPSBookingSchema,
  psBookingFilterSchema,
} from "@/modules/ps-park/validation";

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resourceId: _resourceId, ...rest } = validInput;
    const result = createPSBookingSchema.safeParse(rest);
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
});
