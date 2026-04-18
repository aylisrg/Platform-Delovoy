import { describe, it, expect } from "vitest";
import {
  createRecurringExpenseSchema,
  updateRecurringExpenseSchema,
  createExpenseSchema,
  updateExpenseSchema,
  summaryQuerySchema,
  expenseFilterSchema,
  recurringFilterSchema,
} from "../validation";

describe("createRecurringExpenseSchema", () => {
  const validData = {
    name: "Timeweb VPS",
    category: "IT_INFRASTRUCTURE",
    frequency: "MONTHLY",
    amount: 3500,
    startDate: "2026-04-01",
    nextBillingDate: "2026-05-01",
  };

  it("accepts valid data", () => {
    const result = createRecurringExpenseSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("accepts data with optional fields", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      description: "Cloud hosting",
      currency: "USD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name over 200 chars", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      name: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      category: "INVALID",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid frequency", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      frequency: "WEEKLY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      amount: -100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero amount (for seed data)", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      amount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      startDate: "01-04-2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid currency length", () => {
    const result = createRecurringExpenseSchema.safeParse({
      ...validData,
      currency: "RUBLE",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid categories", () => {
    for (const cat of [
      "IT_INFRASTRUCTURE",
      "ADVERTISING",
      "TELEPHONY",
      "OPERATIONS",
    ]) {
      const result = createRecurringExpenseSchema.safeParse({
        ...validData,
        category: cat,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid frequencies", () => {
    for (const freq of ["MONTHLY", "QUARTERLY", "YEARLY"]) {
      const result = createRecurringExpenseSchema.safeParse({
        ...validData,
        frequency: freq,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("updateRecurringExpenseSchema", () => {
  it("accepts partial update", () => {
    const result = updateRecurringExpenseSchema.safeParse({ amount: 5000 });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updateRecurringExpenseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts isActive toggle", () => {
    const result = updateRecurringExpenseSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it("rejects invalid amount", () => {
    const result = updateRecurringExpenseSchema.safeParse({ amount: -1 });
    expect(result.success).toBe(false);
  });
});

describe("createExpenseSchema", () => {
  const validData = {
    name: "Яндекс.Директ",
    category: "ADVERTISING",
    amount: 15000,
    date: "2026-04-15",
  };

  it("accepts valid data", () => {
    const result = createExpenseSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("rejects zero amount", () => {
    const result = createExpenseSchema.safeParse({ ...validData, amount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createExpenseSchema.safeParse({ ...validData, amount: -100 });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createExpenseSchema.safeParse({ ...validData, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = createExpenseSchema.safeParse({
      ...validData,
      date: "2026/04/15",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateExpenseSchema", () => {
  it("accepts partial update", () => {
    const result = updateExpenseSchema.safeParse({ name: "Updated" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updateExpenseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects zero amount", () => {
    const result = updateExpenseSchema.safeParse({ amount: 0 });
    expect(result.success).toBe(false);
  });
});

describe("summaryQuerySchema", () => {
  it("accepts valid from/to", () => {
    const result = summaryQuerySchema.safeParse({
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (defaults)", () => {
    const result = summaryQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = summaryQuerySchema.safeParse({ from: "April 1" });
    expect(result.success).toBe(false);
  });
});

describe("expenseFilterSchema", () => {
  it("accepts valid filters", () => {
    const result = expenseFilterSchema.safeParse({
      category: "ADVERTISING",
      from: "2026-04-01",
      isAutoGenerated: "true",
      page: "1",
      limit: "20",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAutoGenerated).toBe(true);
      expect(result.data.page).toBe(1);
    }
  });

  it("rejects limit over 100", () => {
    const result = expenseFilterSchema.safeParse({ limit: "200" });
    expect(result.success).toBe(false);
  });
});

describe("recurringFilterSchema", () => {
  it("accepts valid filters", () => {
    const result = recurringFilterSchema.safeParse({
      category: "IT_INFRASTRUCTURE",
      isActive: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it("rejects limit over 50", () => {
    const result = recurringFilterSchema.safeParse({ limit: "100" });
    expect(result.success).toBe(false);
  });
});
