import { describe, it, expect } from "vitest";
import { sendMagicLinkSchema, verifyMagicLinkSchema } from "../validation";

describe("sendMagicLinkSchema", () => {
  it("accepts valid email without password", () => {
    const result = sendMagicLinkSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts valid email with password", () => {
    const result = sendMagicLinkSchema.safeParse({
      email: "user@example.com",
      password: "secret123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = sendMagicLinkSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 6 chars", () => {
    const result = sendMagicLinkSchema.safeParse({
      email: "user@example.com",
      password: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("accepts password of exactly 6 chars", () => {
    const result = sendMagicLinkSchema.safeParse({
      email: "user@example.com",
      password: "abcdef",
    });
    expect(result.success).toBe(true);
  });
});

describe("verifyMagicLinkSchema", () => {
  it("accepts valid token and email", () => {
    const result = verifyMagicLinkSchema.safeParse({
      token: "abc123",
      email: "user@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty token", () => {
    const result = verifyMagicLinkSchema.safeParse({
      token: "",
      email: "user@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = verifyMagicLinkSchema.safeParse({
      token: "abc123",
      email: "not-valid",
    });
    expect(result.success).toBe(false);
  });
});
