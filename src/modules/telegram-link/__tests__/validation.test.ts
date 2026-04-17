import { describe, it, expect } from "vitest";
import { linkRequestSchema, linkConfirmSchema, deepLinkSchema } from "../validation";

describe("linkRequestSchema", () => {
  it("accepts valid email request", () => {
    const result = linkRequestSchema.safeParse({ type: "email", value: "user@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts valid phone request", () => {
    const result = linkRequestSchema.safeParse({ type: "phone", value: "+79001234567" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown type", () => {
    const result = linkRequestSchema.safeParse({ type: "vk", value: "something" });
    expect(result.success).toBe(false);
  });

  it("rejects empty value", () => {
    const result = linkRequestSchema.safeParse({ type: "email", value: "" });
    expect(result.success).toBe(false);
  });
});

describe("linkConfirmSchema", () => {
  it("accepts 6-digit code", () => {
    const result = linkConfirmSchema.safeParse({ code: "123456" });
    expect(result.success).toBe(true);
  });

  it("rejects 5-digit code", () => {
    const result = linkConfirmSchema.safeParse({ code: "12345" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric code", () => {
    const result = linkConfirmSchema.safeParse({ code: "12345a" });
    expect(result.success).toBe(false);
  });

  it("rejects empty code", () => {
    const result = linkConfirmSchema.safeParse({ code: "" });
    expect(result.success).toBe(false);
  });
});

describe("deepLinkSchema", () => {
  it("accepts valid deep link data", () => {
    const result = deepLinkSchema.safeParse({
      token: "a".repeat(48),
      telegramId: "123456789",
      firstName: "Ivan",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short token", () => {
    const result = deepLinkSchema.safeParse({
      token: "short",
      telegramId: "123456789",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing telegramId", () => {
    const result = deepLinkSchema.safeParse({
      token: "a".repeat(48),
    });
    expect(result.success).toBe(false);
  });

  it("optional fields are allowed to be absent", () => {
    const result = deepLinkSchema.safeParse({
      token: "a".repeat(48),
      telegramId: "999",
    });
    expect(result.success).toBe(true);
  });
});
