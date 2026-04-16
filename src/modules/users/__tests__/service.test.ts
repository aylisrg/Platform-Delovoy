import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    adminPermission: {
      count: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
    compare: vi.fn(),
  },
}));

const mockSetUserAdminSections = vi.fn();
vi.mock("@/lib/permissions", () => ({
  setUserAdminSections: (...args: unknown[]) => mockSetUserAdminSections(...args),
}));

import { createUser, listUsers, getUser, updateUser, deleteUser } from "@/modules/users/service";
import { prisma } from "@/lib/db";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  image: true,
  telegramId: true,
  createdAt: true,
  notificationPreference: {
    select: { notifyReleases: true },
  },
};

const mockUser = (overrides = {}) => ({
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
  role: "USER" as const,
  phone: null,
  image: null,
  telegramId: null,
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
      select: USER_SELECT,
    });
    expect(result).toEqual(mockUser());
  });

  it("auto-assigns dashboard permission when creating a MANAGER", async () => {
    const manager = mockUser({ id: "mgr-1", role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(manager as never);

    await createUser({
      email: "manager@example.com",
      password: "password123",
      name: "Manager",
      role: "MANAGER",
    });

    expect(mockSetUserAdminSections).toHaveBeenCalledWith("mgr-1", ["dashboard"]);
  });

  it("does not assign permissions when creating a USER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser() as never);

    await createUser({
      email: "test@example.com",
      password: "password123",
      name: "Test User",
      role: "USER",
    });

    expect(mockSetUserAdminSections).not.toHaveBeenCalled();
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
      where: undefined,
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    expect(result).toEqual(users);
  });

  it("filters by search query", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    await listUsers("test");

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "test", mode: "insensitive" } },
          { email: { contains: "test", mode: "insensitive" } },
          { phone: { contains: "test", mode: "insensitive" } },
        ],
      },
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });
});

describe("getUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a user by id", async () => {
    const user = mockUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);

    const result = await getUser("user-1");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: USER_SELECT,
    });
    expect(result).toEqual(user);
  });

  it("throws USER_NOT_FOUND", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(getUser("nonexistent")).rejects.toThrow("USER_NOT_FOUND");
  });
});

describe("updateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates user role", async () => {
    const user = mockUser();
    const updated = mockUser({ role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);

    const result = await updateUser("user-1", { role: "MANAGER" }, "admin-1");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "MANAGER" },
      select: USER_SELECT,
    });
    expect(result.role).toBe("MANAGER");
  });

  it("auto-assigns dashboard permission when promoting to MANAGER", async () => {
    const user = mockUser({ role: "USER" });
    const updated = mockUser({ role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);
    vi.mocked(prisma.adminPermission.count).mockResolvedValue(0);

    await updateUser("user-1", { role: "MANAGER" }, "admin-1");

    expect(mockSetUserAdminSections).toHaveBeenCalledWith("user-1", ["dashboard"]);
  });

  it("does not overwrite existing permissions when promoting to MANAGER", async () => {
    const user = mockUser({ role: "USER" });
    const updated = mockUser({ role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);
    vi.mocked(prisma.adminPermission.count).mockResolvedValue(3);

    await updateUser("user-1", { role: "MANAGER" }, "admin-1");

    expect(mockSetUserAdminSections).not.toHaveBeenCalled();
  });

  it("throws CANNOT_DEMOTE_SELF", async () => {
    await expect(
      updateUser("admin-1", { role: "USER" }, "admin-1")
    ).rejects.toThrow("CANNOT_DEMOTE_SELF");
  });

  it("throws USER_NOT_FOUND", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      updateUser("nonexistent", { role: "MANAGER" }, "admin-1")
    ).rejects.toThrow("USER_NOT_FOUND");
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
