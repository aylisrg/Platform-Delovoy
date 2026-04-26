import { describe, expect, it } from "vitest";
import {
  createCommentSchema,
  createTaskSchema,
  reportTaskSchema,
  taskListQuerySchema,
} from "../validation";

describe("createTaskSchema", () => {
  it("requires non-empty title", () => {
    expect(createTaskSchema.safeParse({}).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
  });

  it("trims title and accepts minimum input", () => {
    const r = createTaskSchema.safeParse({ title: "  hello  " });
    expect(r.success).toBe(true);
    expect(r.success && r.data.title).toBe("hello");
  });

  it("clamps collaborators to ≤10", () => {
    const ten = Array.from({ length: 11 }, (_, i) => `cuid${i}`);
    const r = createTaskSchema.safeParse({
      title: "ok",
      collaboratorUserIds: ten,
    });
    expect(r.success).toBe(false);
  });
});

describe("reportTaskSchema", () => {
  it("requires email or phone", () => {
    const r = reportTaskSchema.safeParse({
      description: "Сломан кран в офисе 301",
    });
    expect(r.success).toBe(false);
  });

  it("accepts email-only", () => {
    const r = reportTaskSchema.safeParse({
      description: "Сломан кран в офисе 301",
      email: "user@example.com",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid phone format", () => {
    const r = reportTaskSchema.safeParse({
      description: "Сломан кран в офисе 301",
      phone: "abc",
    });
    expect(r.success).toBe(false);
  });

  it("requires description min length 10", () => {
    const r = reportTaskSchema.safeParse({
      description: "short",
      email: "a@b.co",
    });
    expect(r.success).toBe(false);
  });
});

describe("createCommentSchema", () => {
  it("trims and rejects empty body", () => {
    expect(createCommentSchema.safeParse({ body: "" }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: "   " }).success).toBe(false);
  });
  it("limits attachments to ≤10", () => {
    const att = Array.from({ length: 11 }, () => ({
      url: "https://example.com/x",
      filename: "f.txt",
    }));
    expect(
      createCommentSchema.safeParse({ body: "ok", attachments: att }).success
    ).toBe(false);
  });
});

describe("taskListQuerySchema", () => {
  it("coerces string priority array", () => {
    const r = taskListQuerySchema.safeParse({
      priority: ["HIGH", "CRITICAL"],
    });
    expect(r.success).toBe(true);
  });
  it("default page=1, limit=50", () => {
    const r = taskListQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(50);
    }
  });
  it("clamps limit to 200", () => {
    const r = taskListQuerySchema.safeParse({ limit: 9999 });
    expect(r.success).toBe(false);
  });
});
