import { describe, it, expect } from "vitest";
import { clientFilterSchema, mergeClientsSchema, mergePreviewSchema } from "@/modules/clients/validation";

describe("clientFilterSchema", () => {
  it("accepts empty filter", () => {
    const result = clientFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts full valid filter", () => {
    const result = clientFilterSchema.safeParse({
      search: "Иванов",
      moduleSlug: "gazebos",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      sortBy: "totalSpent",
      sortOrder: "desc",
      limit: "50",
      offset: "0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it("accepts all valid moduleSlug values", () => {
    for (const slug of ["gazebos", "ps-park", "cafe"]) {
      const result = clientFilterSchema.safeParse({ moduleSlug: slug });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid moduleSlug", () => {
    const result = clientFilterSchema.safeParse({ moduleSlug: "parking" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid sortBy values", () => {
    for (const sortBy of ["totalSpent", "lastActivity", "createdAt", "name"]) {
      const result = clientFilterSchema.safeParse({ sortBy });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid sortBy", () => {
    const result = clientFilterSchema.safeParse({ sortBy: "email" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = clientFilterSchema.safeParse({ dateFrom: "01-01-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects too-long search", () => {
    const result = clientFilterSchema.safeParse({ search: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("coerces limit and offset from strings", () => {
    const result = clientFilterSchema.safeParse({
      limit: "25",
      offset: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  it("rejects limit over 200", () => {
    const result = clientFilterSchema.safeParse({ limit: "300" });
    expect(result.success).toBe(false);
  });

  it("rejects negative offset", () => {
    const result = clientFilterSchema.safeParse({ offset: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sortOrder", () => {
    const result = clientFilterSchema.safeParse({ sortOrder: "up" });
    expect(result.success).toBe(false);
  });
});

describe("mergeClientsSchema", () => {
  it("accepts valid merge input", () => {
    const result = mergeClientsSchema.safeParse({
      primaryId: "abc123",
      secondaryId: "def456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when primaryId equals secondaryId", () => {
    const result = mergeClientsSchema.safeParse({
      primaryId: "abc123",
      secondaryId: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty primaryId", () => {
    const result = mergeClientsSchema.safeParse({
      primaryId: "",
      secondaryId: "def456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty secondaryId", () => {
    const result = mergeClientsSchema.safeParse({
      primaryId: "abc123",
      secondaryId: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(mergeClientsSchema.safeParse({}).success).toBe(false);
    expect(mergeClientsSchema.safeParse({ primaryId: "abc" }).success).toBe(false);
  });
});

describe("mergePreviewSchema", () => {
  it("accepts valid preview input", () => {
    const result = mergePreviewSchema.safeParse({
      primaryId: "abc123",
      secondaryId: "def456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty IDs", () => {
    const result = mergePreviewSchema.safeParse({
      primaryId: "",
      secondaryId: "def456",
    });
    expect(result.success).toBe(false);
  });
});
