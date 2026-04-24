import { describe, it, expect } from "vitest";
import {
  CreateTaskSchema,
  UpdateStatusSchema,
  CreateCommentSchema,
  PublicReportSchema,
  CreateCategorySchema,
} from "../validation";

describe("CreateTaskSchema", () => {
  it("accepts a minimal INTERNAL task", () => {
    const parsed = CreateTaskSchema.parse({ title: "Fix stuff" });
    expect(parsed.title).toBe("Fix stuff");
    expect(parsed.type).toBe("INTERNAL");
    expect(parsed.source).toBe("MANUAL");
  });

  it("rejects short title", () => {
    expect(() => CreateTaskSchema.parse({ title: "x" })).toThrow();
  });

  it("coerces dueDate string to Date", () => {
    const parsed = CreateTaskSchema.parse({
      title: "With due",
      dueDate: "2026-05-01T10:00:00Z",
    });
    expect(parsed.dueDate).toBeInstanceOf(Date);
  });

  it("rejects labels over limit", () => {
    const labels = Array(25).fill("x");
    expect(() =>
      CreateTaskSchema.parse({ title: "Hello", labels })
    ).toThrow();
  });
});

describe("UpdateStatusSchema", () => {
  it("accepts valid status", () => {
    expect(UpdateStatusSchema.parse({ status: "IN_PROGRESS" }).status).toBe(
      "IN_PROGRESS"
    );
  });

  it("rejects invalid status", () => {
    expect(() => UpdateStatusSchema.parse({ status: "WAT" })).toThrow();
  });
});

describe("CreateCommentSchema", () => {
  it("rejects empty body", () => {
    expect(() => CreateCommentSchema.parse({ body: "   " })).toThrow();
  });

  it("rejects oversize body", () => {
    const body = "a".repeat(20_000);
    expect(() => CreateCommentSchema.parse({ body })).toThrow();
  });
});

describe("PublicReportSchema", () => {
  it("accepts with email only", () => {
    const parsed = PublicReportSchema.parse({
      name: "Иван",
      contactEmail: "ivan@example.com",
      officeInput: "301",
      description: "Не работает кондиционер",
    });
    expect(parsed.contactEmail).toBe("ivan@example.com");
  });

  it("accepts with phone only", () => {
    const parsed = PublicReportSchema.parse({
      name: "Иван",
      contactPhone: "+79161234567",
      officeInput: "301",
      description: "Не работает",
    });
    expect(parsed.contactPhone).toBe("+79161234567");
  });

  it("rejects when neither email nor phone present", () => {
    expect(() =>
      PublicReportSchema.parse({
        name: "Иван",
        officeInput: "301",
        description: "Не работает",
      })
    ).toThrow();
  });

  it("rejects short description", () => {
    expect(() =>
      PublicReportSchema.parse({
        name: "Иван",
        contactEmail: "i@e.com",
        officeInput: "301",
        description: "ай",
      })
    ).toThrow();
  });
});

describe("CreateCategorySchema", () => {
  it("accepts a valid slug", () => {
    const parsed = CreateCategorySchema.parse({
      slug: "plumbing",
      name: "Сантехника",
    });
    expect(parsed.slug).toBe("plumbing");
  });

  it("rejects uppercase / cyrillic slug", () => {
    expect(() =>
      CreateCategorySchema.parse({ slug: "Plumbing", name: "x" })
    ).toThrow();
    expect(() =>
      CreateCategorySchema.parse({ slug: "сантехника", name: "x" })
    ).toThrow();
  });
});
