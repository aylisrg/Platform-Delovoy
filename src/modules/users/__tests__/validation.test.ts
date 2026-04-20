import { describe, it, expect } from "vitest";
import { createUserSchema } from "@/modules/users/validation";

describe("createUserSchema", () => {
  it("accepts valid input", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
      password: "password123",
      name: "Тест Пользователь",
      role: "USER",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all roles", () => {
    for (const role of ["SUPERADMIN", "ADMIN", "MANAGER", "USER"]) {
      const result = createUserSchema.safeParse({
        email: "test@example.com",
        password: "password123",
        name: "Test",
        role,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional phone", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
      password: "password123",
      name: "Test",
      role: "USER",
      phone: "+7 999 123 45 67",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = createUserSchema.safeParse({
      email: "not-an-email",
      password: "password123",
      name: "Test",
      role: "USER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short password", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
      password: "123",
      name: "Test",
      role: "USER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
      password: "password123",
      name: "",
      role: "USER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = createUserSchema.safeParse({
      email: "test@example.com",
      password: "password123",
      name: "Test",
      role: "GUEST",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = createUserSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
