import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
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

const mockChangeUserRole = vi.fn();
vi.mock("@/modules/users/exclusion", () => ({
  changeUserRole: (...args: unknown[]) => mockChangeUserRole(...args),
}));

const mockGetDeletionBlockers = vi.fn();
vi.mock("@/modules/users/deletion-blockers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/users/deletion-blockers")>()),
  getDeletionBlockers: (...args: unknown[]) => mockGetDeletionBlockers(...args),
}));

const mockPublishAuthState = vi.fn();
vi.mock("@/lib/session-revocation", () => ({
  publishAuthState: (...args: unknown[]) => mockPublishAuthState(...args),
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

const mockEnsureManagerNotifyDefaults = vi.fn();
vi.mock("@/modules/notifications/release-notify", () => ({
  ensureManagerNotifyDefaults: (...args: unknown[]) =>
    mockEnsureManagerNotifyDefaults(...args),
}));

import { createUser, listUsers, getUser, updateUser, deleteUser } from "@/modules/users/service";
import { DomainError } from "@/modules/users/errors";
import { prisma } from "@/lib/db";

async function domainRejection(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

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

  it("subscribes new MANAGER to release notifications by default", async () => {
    const manager = mockUser({ id: "mgr-1", role: "MANAGER" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(manager as never);

    await createUser({
      email: "manager@example.com",
      password: "password123",
      name: "Manager",
      role: "MANAGER",
    });

    expect(mockEnsureManagerNotifyDefaults).toHaveBeenCalledWith("mgr-1");
  });

  it("subscribes new SUPERADMIN to release notifications by default", async () => {
    const admin = mockUser({ id: "adm-1", role: "SUPERADMIN" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue(admin as never);

    await createUser({
      email: "admin@example.com",
      password: "password123",
      name: "Admin",
      role: "SUPERADMIN",
    });

    expect(mockEnsureManagerNotifyDefaults).toHaveBeenCalledWith("adm-1");
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
    expect(mockEnsureManagerNotifyDefaults).not.toHaveBeenCalled();
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
        { mergedIntoUserId: null },
        { id: { not: "system" } },
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
      AND: [
        { mergedIntoUserId: null },
        { id: { not: "system" } },
        { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } },
      ],
    });
  });

  it("never lists merged tombstones or the technical system user (ADR 2026-10-25 §5.1)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    await listUsers();

    const callArgs = vi.mocked(prisma.user.findMany).mock.calls[0][0];
    expect(callArgs?.where).toEqual({ AND: [{ mergedIntoUserId: null }, { id: { not: "system" } }] });
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
  const exclusion = {
    userId: "user-1",
    role: "USER" as const,
    removed: { sections: ["cafe"], modules: [], recipientLists: [], subscriptions: [] },
    sessionsRevoked: true as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AC-A2.1: delegates a role change to changeUserRole (with confirmSeeded)", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ id: "user-1", role: "USER" } as never)
      .mockResolvedValueOnce(mockUser({ role: "MANAGER" }) as never);
    mockChangeUserRole.mockResolvedValue({ kind: "promoted", oldRole: "USER", newRole: "MANAGER" });

    const result = await updateUser("user-1", { role: "MANAGER", confirmSeeded: true }, "admin-1");

    expect(mockChangeUserRole).toHaveBeenCalledWith("user-1", "MANAGER", "admin-1", { confirmSeeded: true });
    // No profile fields → no extra update, the fresh row is returned.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { id: "user-1" }, select: USER_SELECT });
    expect(result.role).toBe("MANAGER");
    expect(result).not.toHaveProperty("exclusion");
  });

  it("AC-A2.1: a change to USER returns the exclusion result", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ id: "user-1", role: "MANAGER" } as never)
      .mockResolvedValueOnce(mockUser({ role: "USER" }) as never);
    mockChangeUserRole.mockResolvedValue({ kind: "excluded", oldRole: "MANAGER", newRole: "USER", exclusion });

    const result = await updateUser("user-1", { role: "USER" }, "admin-1");

    expect(result.exclusion).toEqual(exclusion);
  });

  it("does not call changeUserRole when the role is unchanged or absent", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1", role: "MANAGER" } as never);
    vi.mocked(prisma.user.update).mockResolvedValue(mockUser({ role: "MANAGER", name: "Новое" }) as never);

    await updateUser("user-1", { role: "MANAGER", name: "Новое" }, "admin-1");
    await updateUser("user-1", { phone: "" }, "admin-1");

    expect(mockChangeUserRole).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "user-1" },
      data: { name: "Новое" },
      select: USER_SELECT,
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: "user-1" },
      data: { phone: null },
      select: USER_SELECT,
    });
  });

  it("updates name/phone/telegramId after the role change", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1", role: "USER" } as never);
    mockChangeUserRole.mockResolvedValue({ kind: "promoted", oldRole: "USER", newRole: "ADMIN" });
    vi.mocked(prisma.user.update).mockResolvedValue(mockUser({ role: "ADMIN" }) as never);

    await updateUser("user-1", { role: "ADMIN", telegramId: "", name: "Пётр" }, "admin-1");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Пётр", telegramId: null },
      select: USER_SELECT,
    });
    expect(mockChangeUserRole.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.user.update).mock.invocationCallOrder[0],
    );
  });

  it("a guard from changeUserRole propagates and no field is written", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "admin-1", role: "SUPERADMIN" } as never);
    mockChangeUserRole.mockRejectedValue(new DomainError("CANNOT_DEMOTE_SELF", "Нельзя понизить роль самому себе", 400));

    const error = await domainRejection(updateUser("admin-1", { role: "USER", name: "X" }, "admin-1"));

    expect(error.code).toBe("CANNOT_DEMOTE_SELF");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("throws USER_NOT_FOUND (404)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const error = await domainRejection(updateUser("nonexistent", { role: "MANAGER" }, "admin-1"));

    expect(error.code).toBe("USER_NOT_FOUND");
    expect(error.status).toBe(404);
    expect(mockChangeUserRole).not.toHaveBeenCalled();
  });
});

describe("deleteUser (US-A3)", () => {
  const txDelete = { op: "delete" };
  const txAudit = { op: "audit" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      role: "USER",
      mergedIntoUserId: null,
    } as never);
    vi.mocked(prisma.user.delete).mockReturnValue(txDelete as never);
    vi.mocked(prisma.auditLog.create).mockReturnValue(txAudit as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    mockGetDeletionBlockers.mockResolvedValue([]);
    mockPublishAuthState.mockResolvedValue(undefined);
  });

  it("AC-A3.5: deletes an account without history and audits user.delete {role}", async () => {
    await deleteUser("user-1", "admin-1");

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "admin-1",
        action: "user.delete",
        entity: "User",
        entityId: "user-1",
        metadata: { role: "USER" },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([txDelete, txAudit]);
    expect(mockPublishAuthState).toHaveBeenCalledWith("user-1");
  });

  it("AC-A3.1: USER_HAS_HISTORY 409 with blockers and isTeamMember=false for a client", async () => {
    const blockers = [
      { type: "AuditLog", label: "Журнал действий", count: 214 },
      { type: "Subscription", label: "Абонементы Плей Парка", count: 2 },
    ];
    mockGetDeletionBlockers.mockResolvedValue(blockers);

    const error = await domainRejection(deleteUser("user-1", "admin-1"));

    expect(error.code).toBe("USER_HAS_HISTORY");
    expect(error.status).toBe(409);
    expect(error.metadata).toEqual({ blockers, isTeamMember: false });
    expect(error.message).toContain("Жёсткое удаление не поддерживается");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("AC-A3.3: a team member gets isTeamMember=true and the «исключите» text", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "mgr-1",
      role: "MANAGER",
      mergedIntoUserId: null,
    } as never);
    mockGetDeletionBlockers.mockResolvedValue([{ type: "TaskAssignee", label: "Задачи", count: 3 }]);

    const error = await domainRejection(deleteUser("mgr-1", "admin-1"));

    expect(error.metadata).toMatchObject({ isTeamMember: true });
    expect(error.message).toBe(
      "Удалить нельзя: у аккаунта есть история. Мы не удаляем аккаунты с журналом действий, бронями и заказами. Исключите сотрудника из команды — доступ закроется, история сохранится.",
    );
  });

  it("AC-A3.2: P2003 race → blockers recomputed → USER_HAS_HISTORY", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));
    mockGetDeletionBlockers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ type: "Subscription", label: "Абонементы Плей Парка", count: 1 }]);

    const error = await domainRejection(deleteUser("user-1", "admin-1"));

    expect(error.code).toBe("USER_HAS_HISTORY");
    expect(error.metadata).toEqual({
      blockers: [{ type: "Subscription", label: "Абонементы Плей Парка", count: 1 }],
      isTeamMember: false,
    });
    expect(mockPublishAuthState).not.toHaveBeenCalled();
  });

  it("AC-A3.2: P2003 with no known blocker → fallback «Связанные записи — 1»", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));

    const error = await domainRejection(deleteUser("user-1", "admin-1"));

    expect(error.metadata).toEqual({
      blockers: [{ type: "Other", label: "Связанные записи", count: 1 }],
      isTeamMember: false,
    });
  });

  it("other DB errors are rethrown as-is", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("boom"));
    await expect(deleteUser("user-1", "admin-1")).rejects.toThrow("boom");
  });

  it("AC-A3.5: CANNOT_DELETE_SELF (400) without touching the DB", async () => {
    const error = await domainRejection(deleteUser("admin-1", "admin-1"));
    expect(error.code).toBe("CANNOT_DELETE_SELF");
    expect(error.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("throws USER_NOT_FOUND (404) if user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const error = await domainRejection(deleteUser("nonexistent", "admin-1"));
    expect(error.code).toBe("USER_NOT_FOUND");
    expect(error.status).toBe(404);
  });
});
