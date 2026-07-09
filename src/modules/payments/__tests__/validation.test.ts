import { describe, it, expect } from "vitest";
import { refundRequestSchema, paymentsListQuerySchema } from "../validation";

describe("refundRequestSchema", () => {
  it("принимает валидную причину", () => {
    const parsed = refundRequestSchema.safeParse({ reason: "Гость отменил поездку" });
    expect(parsed.success).toBe(true);
  });

  it("отклоняет пустую/короткую причину", () => {
    expect(refundRequestSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(refundRequestSchema.safeParse({ reason: "ab" }).success).toBe(false);
    expect(refundRequestSchema.safeParse({}).success).toBe(false);
  });

  it("отклоняет причину длиннее 300 символов", () => {
    expect(refundRequestSchema.safeParse({ reason: "х".repeat(301) }).success).toBe(false);
  });
});

describe("paymentsListQuerySchema", () => {
  it("применяет дефолты пагинации", () => {
    const parsed = paymentsListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.perPage).toBe(25);
  });

  it("коэрсит строки из query string", () => {
    const parsed = paymentsListQuerySchema.parse({ page: "3", perPage: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.perPage).toBe(50);
  });

  it("отклоняет неизвестный статус и perPage > 100", () => {
    expect(paymentsListQuerySchema.safeParse({ status: "PAID" }).success).toBe(false);
    expect(paymentsListQuerySchema.safeParse({ perPage: "500" }).success).toBe(false);
  });
});
