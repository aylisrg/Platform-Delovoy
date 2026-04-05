import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
    compare: vi.fn(),
  },
}));

import { createUser, listUsers, deleteUser } from "@/modules/users/service";
import { prisma } from "@/lib/db";

const mockUser = (overrides = {}) => ({
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
  role: "USER" as const,
  phone: null,
  createdAt: new Date("2025-01-01"),
  ...overrides,
});

describe("createUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a user with hashed password", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser() as never);

    const result = await createUser({
      email: "test@example.com",
      password: "password123",
      name: "Test User",
      role: "USER",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "test@example.com" },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "test@example.com",
        name: "Test User",
        role: "USER",
        phone: null,
        passwordHash: "$2a$10$hashedpassword",
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        createdAt: true,
      },
    });
    expect(result).toEqual(mockUser());
  });

  it("throws USER_EXISTS if email already taken", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser() as never);

    await expect(
      createUser({
        email: "test@example.com",
        password: "password123",
        name: "Test",
        role: "USER",
      })
    ).rejects.toThrow("USER_EXISTS");
  });
});

describe("listUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns users ordered by createdAt desc", async () => {
    const users = [mockUser(), mockUser({ id: "user-2", email: "other@example.com" })];
    vi.mocked(prisma.user.findMany).mockResolvedValue(users as never);

    const result = await listUsers();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    expect(result).toEqual(users);
  });
});

describe("deleteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser() as never);
    vi.mocked(prisma.user.delete).mockResolvedValue(mockUser() as never);

    await deleteUser("user-1", "admin-1");

    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });
  });

  it("throws CANNOT_DELETE_SELF", async () => {
    await expect(deleteUser("admin-1", "admin-1")).rejects.toThrow(
      "CANNOT_DELETE_SELF"
    );
  });

  it("throws USER_NOT_FOUND if user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(deleteUser("nonexistent", "admin-1")).rejects.toThrow(
      "USER_NOT_FOUND"
    );
  });
});
