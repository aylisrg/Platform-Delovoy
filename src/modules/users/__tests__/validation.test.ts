import { describe, it, expect } from "vitest";
import {
  createUserSchema,
  excludeUserSchema,
  permissionsUpdateSchema,
  updateUserSchema,
  userIdParamSchema,
} from "@/modules/users/validation";

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

describe("excludeUserSchema (ADR 2026-10-25 §6.2)", () => {
  it("accepts an empty body and the seeded confirmation", () => {
    expect(excludeUserSchema.safeParse({}).success).toBe(true);
    expect(excludeUserSchema.parse({ confirmSeeded: true })).toEqual({ confirmSeeded: true });
  });

  it("is strict: unknown keys and non-boolean values are rejected", () => {
    expect(excludeUserSchema.safeParse({ confirmSeeded: true, role: "USER" }).success).toBe(false);
    expect(excludeUserSchema.safeParse({ confirmSeeded: "yes" }).success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  it("accepts confirmSeeded together with a role", () => {
    expect(updateUserSchema.parse({ role: "ADMIN", confirmSeeded: true })).toEqual({
      role: "ADMIN",
      confirmSeeded: true,
    });
  });

  it("rejects an unknown role", () => {
    expect(updateUserSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });
});

describe("permissionsUpdateSchema", () => {
  it("accepts a list of section slugs", () => {
    expect(permissionsUpdateSchema.safeParse({ sections: ["cafe", "nedelovoy"] }).success).toBe(true);
    expect(permissionsUpdateSchema.safeParse({ sections: [] }).success).toBe(true);
  });

  it("bounds the list and every slug", () => {
    expect(permissionsUpdateSchema.safeParse({ sections: Array(51).fill("cafe") }).success).toBe(false);
    expect(permissionsUpdateSchema.safeParse({ sections: ["x".repeat(51)] }).success).toBe(false);
    expect(permissionsUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("userIdParamSchema", () => {
  it("accepts ids up to 64 chars and rejects empty / longer", () => {
    expect(userIdParamSchema.safeParse("ckuser123").success).toBe(true);
    expect(userIdParamSchema.safeParse("").success).toBe(false);
    expect(userIdParamSchema.safeParse("x".repeat(65)).success).toBe(false);
  });
});
