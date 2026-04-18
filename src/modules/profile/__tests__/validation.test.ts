import { describe, it, expect } from "vitest";
import {
  updateNameSchema,
  attachEmailRequestSchema,
  attachEmailConfirmSchema,
  attachPhoneRequestSchema,
  attachPhoneConfirmSchema,
  detachChannelSchema,
} from "../validation";

describe("updateNameSchema", () => {
  it("accepts valid name", () => {
    const result = updateNameSchema.safeParse({ name: "Иван Иванов" });
    expect(result.success).toBe(true);
  });

  it("rejects name shorter than 2 chars", () => {
    const result = updateNameSchema.safeParse({ name: "И" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("минимум 2");
  });

  it("rejects name longer than 100 chars", () => {
    const result = updateNameSchema.safeParse({ name: "А".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("trims whitespace", () => {
    const result = updateNameSchema.safeParse({ name: "  Иван  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Иван");
    }
  });

  it("rejects missing name", () => {
    const result = updateNameSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("attachEmailRequestSchema", () => {
  it("accepts valid email", () => {
    const result = attachEmailRequestSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(true);
  });

  it("lowercases the email", () => {
    const result = attachEmailRequestSchema.safeParse({ email: "User@Example.COM" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejects invalid email", () => {
    const result = attachEmailRequestSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects missing email", () => {
    const result = attachEmailRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("attachEmailConfirmSchema", () => {
  it("accepts valid token", () => {
    const result = attachEmailConfirmSchema.safeParse({ token: "abc123" });
    expect(result.success).toBe(true);
  });

  it("rejects empty token", () => {
    const result = attachEmailConfirmSchema.safeParse({ token: "" });
    expect(result.success).toBe(false);
  });
});

describe("attachPhoneRequestSchema", () => {
  it("accepts valid phone", () => {
    const result = attachPhoneRequestSchema.safeParse({ phone: "+79001234567" });
    expect(result.success).toBe(true);
  });

  it("rejects short phone", () => {
    const result = attachPhoneRequestSchema.safeParse({ phone: "123" });
    expect(result.success).toBe(false);
  });

  it("rejects missing phone", () => {
    const result = attachPhoneRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("attachPhoneConfirmSchema", () => {
  it("accepts valid phone and 6-digit code", () => {
    const result = attachPhoneConfirmSchema.safeParse({
      phone: "+79001234567",
      code: "123456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects code not 6 digits", () => {
    const result = attachPhoneConfirmSchema.safeParse({
      phone: "+79001234567",
      code: "12345",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("6");
  });

  it("rejects missing code", () => {
    const result = attachPhoneConfirmSchema.safeParse({ phone: "+79001234567" });
    expect(result.success).toBe(false);
  });
});

describe("detachChannelSchema", () => {
  it("accepts telegram", () => {
    const result = detachChannelSchema.safeParse({ channel: "telegram" });
    expect(result.success).toBe(true);
  });

  it("accepts email", () => {
    const result = detachChannelSchema.safeParse({ channel: "email" });
    expect(result.success).toBe(true);
  });

  it("accepts phone", () => {
    const result = detachChannelSchema.safeParse({ channel: "phone" });
    expect(result.success).toBe(true);
  });

  it("accepts yandex", () => {
    const result = detachChannelSchema.safeParse({ channel: "yandex" });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported channel", () => {
    const result = detachChannelSchema.safeParse({ channel: "vk" });
    expect(result.success).toBe(false);
  });

  it("rejects missing channel", () => {
    const result = detachChannelSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
