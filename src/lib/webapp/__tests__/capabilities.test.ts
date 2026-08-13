import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationEventPreference: { findMany: vi.fn() },
  },
}));

const mockGetUserAdminSections = vi.fn();
vi.mock("@/lib/permissions", () => ({
  getUserAdminSections: (...args: unknown[]) => mockGetUserAdminSections(...args),
}));

import { prisma } from "@/lib/db";
import { getWebAppCapabilities, resolveManagedCategories } from "../capabilities";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.notificationEventPreference.findMany).mockResolvedValue([]);
});

describe("getWebAppCapabilities", () => {
  it("USER: гостевые capabilities без единого запроса в БД", async () => {
    const caps = await getWebAppCapabilities({ id: "u1", role: "USER" });
    expect(caps).toEqual({
      isStaff: false,
      staffSections: [],
      notificationCategories: [],
      canNotificationCenter: false,
    });
    expect(mockGetUserAdminSections).not.toHaveBeenCalled();
    expect(prisma.notificationEventPreference.findMany).not.toHaveBeenCalled();
  });

  it("MANAGER с секцией gazebos: категория bookings, Центр доступен", async () => {
    mockGetUserAdminSections.mockResolvedValue(["gazebos"]);
    const caps = await getWebAppCapabilities({ id: "u1", role: "MANAGER" });
    expect(caps.isStaff).toBe(true);
    expect(caps.staffSections).toEqual(["gazebos"]);
    expect(caps.notificationCategories).toEqual(["bookings"]);
    expect(caps.canNotificationCenter).toBe(true);
  });

  it("MANAGER без секций и явных подписок: Центр недоступен", async () => {
    mockGetUserAdminSections.mockResolvedValue([]);
    const caps = await getWebAppCapabilities({ id: "u1", role: "MANAGER" });
    expect(caps.isStaff).toBe(true);
    expect(caps.notificationCategories).toEqual([]);
    expect(caps.canNotificationCenter).toBe(false);
  });

  it("staffSections — passthrough из getUserAdminSections (strict-access учтён там)", async () => {
    // getUserAdminSections для SUPERADMIN без гранта не возвращает nedelovoy
    mockGetUserAdminSections.mockResolvedValue(["gazebos", "monitoring"]);
    const caps = await getWebAppCapabilities({ id: "sa", role: "SUPERADMIN" });
    expect(caps.staffSections).not.toContain("nedelovoy");
  });
});

describe("resolveManagedCategories", () => {
  it("SUPERADMIN видит system без секции monitoring (superadminAlways)", async () => {
    const categories = await resolveManagedCategories(
      { id: "sa", role: "SUPERADMIN" },
      []
    );
    expect(categories.map((c) => c.key)).toContain("system");
  });

  it("MANAGER с monitoring видит system; без — нет (AC-5.3)", async () => {
    const withMonitoring = await resolveManagedCategories(
      { id: "m1", role: "MANAGER" },
      ["monitoring"]
    );
    expect(withMonitoring.map((c) => c.key)).toContain("system");

    const without = await resolveManagedCategories(
      { id: "m2", role: "MANAGER" },
      ["cafe"]
    );
    expect(without.map((c) => c.key)).not.toContain("system");
  });

  it("ADMIN и MANAGER с одинаковыми секциями получают одинаковый набор (AC-5.4)", async () => {
    const admin = await resolveManagedCategories(
      { id: "a", role: "ADMIN" },
      ["gazebos", "cafe"]
    );
    const manager = await resolveManagedCategories(
      { id: "m", role: "MANAGER" },
      ["gazebos", "cafe"]
    );
    expect(admin.map((c) => c.key)).toEqual(manager.map((c) => c.key));
  });

  it("grandfather: явная строка system.release открывает категорию system (AC-6.5)", async () => {
    vi.mocked(prisma.notificationEventPreference.findMany).mockResolvedValue([
      { eventType: "system.release" },
    ] as never);

    const categories = await resolveManagedCategories(
      { id: "m1", role: "MANAGER" },
      ["cafe"]
    );
    expect(categories.map((c) => c.key)).toEqual(
      expect.arrayContaining(["cafe", "system"])
    );
  });

  it("без строк-подписок grandfather не срабатывает", async () => {
    const categories = await resolveManagedCategories(
      { id: "m1", role: "MANAGER" },
      ["cafe"]
    );
    expect(categories.map((c) => c.key)).toEqual(["cafe"]);
  });
});
