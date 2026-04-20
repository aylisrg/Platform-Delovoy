import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    adminPermission: {
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
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

  it("returns users with total and pagination", async () => {
    const users = [
      { ...mockUser(), accounts: [{ provider: "yandex" }] },
      { ...mockUser({ id: "user-2", email: "other@example.com" }), accounts: [] },
    ];
    vi.mocked(prisma.user.findMany).mockResolvedValue(users as never);
    vi.mocked(prisma.user.count).mockResolvedValue(2);

    const result = await listUsers();

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(2);
    // Check authProviders mapping
    const first = result.users[0] as Record<string, unknown>;
    expect(first.authProviders).toContain("yandex");
  });

  it("filters by search query", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    await listUsers({ search: "test" });

    const callArgs = vi.mocked(prisma.user.findMany).mock.calls[0][0];
    expect(callArgs?.where).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: "test", mode: "insensitive" } },
            { email: { contains: "test", mode: "insensitive" } },
            { phone: { contains: "test", mode: "insensitive" } },
            { telegramId: { contains: "test", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("filters team (SUPERADMIN + ADMIN + MANAGER) when role=team", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    await listUsers({ role: "team" });

    const callArgs = vi.mocked(prisma.user.findMany).mock.calls[0][0];
    expect(callArgs?.where).toEqual({
      AND: [{ role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } }],
    });
  });

  it("respects limit and offset", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    await listUsers({ limit: 10, offset: 20 });

    const callArgs = vi.mocked(prisma.user.findMany).mock.calls[0][0];
    expect(callArgs?.take).toBe(10);
    expect(callArgs?.skip).toBe(20);
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
    vi.mocked(prisma.adminPermission.upsert).mockResolvedValue({} as never);

    await updateUser("user-1", { role: "MANAGER" }, "admin-1");

    expect(prisma.adminPermission.upsert).toHaveBeenCalledWith({
      where: { userId_section: { userId: "user-1", section: "dashboard" } },
      create: { userId: "user-1", section: "dashboard" },
      update: {},
    });
  });

  it("adds dashboard without clearing existing permissions when promoting to MANAGER", async () => {
    // upsert is called in all cases — if dashboard already exists, update:{} is a no-op
    const user = mockUser({ role: "USER" });
    const updated = mockUser({ role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);
    vi.mocked(prisma.adminPermission.upsert).mockResolvedValue({} as never);

    await updateUser("user-1", { role: "MANAGER" }, "admin-1");

    // setUserAdminSections must NOT be called (would wipe existing permissions)
    expect(mockSetUserAdminSections).not.toHaveBeenCalled();
    // only upsert of dashboard is done
    expect(prisma.adminPermission.upsert).toHaveBeenCalledTimes(1);
  });

  it("creates audit log when role changes", async () => {
    const user = mockUser({ role: "USER" });
    const updated = mockUser({ role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);
    vi.mocked(prisma.adminPermission.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await updateUser("user-1", { role: "MANAGER" }, "admin-1");

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "admin-1",
        action: "user.role.change",
        entity: "User",
        entityId: "user-1",
        metadata: { oldRole: "USER", newRole: "MANAGER" },
      },
    });
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
