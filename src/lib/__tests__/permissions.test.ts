import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    moduleAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    module: {
      findMany: vi.fn(),
    },
    adminPermission: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import {
  hasRole,
  hasModuleAccess,
  getUserModules,
  hasAdminSectionAccess,
  getUserAdminSections,
  setUserAdminSections,
  extractAdminSection,
  ADMIN_SECTIONS,
  ADMIN_SECTION_SLUGS,
} from "@/lib/permissions";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// hasRole
// ============================================================
describe("hasRole", () => {
  it("SUPERADMIN passes SUPERADMIN check", () => {
    expect(hasRole({ id: "1", role: "SUPERADMIN" }, "SUPERADMIN")).toBe(true);
  });

  it("SUPERADMIN passes MANAGER check", () => {
    expect(hasRole({ id: "1", role: "SUPERADMIN" }, "MANAGER")).toBe(true);
  });

  it("SUPERADMIN passes USER check", () => {
    expect(hasRole({ id: "1", role: "SUPERADMIN" }, "USER")).toBe(true);
  });

  it("MANAGER passes MANAGER check", () => {
    expect(hasRole({ id: "1", role: "MANAGER" }, "MANAGER")).toBe(true);
  });

  it("MANAGER passes USER check", () => {
    expect(hasRole({ id: "1", role: "MANAGER" }, "USER")).toBe(true);
  });

  it("MANAGER fails SUPERADMIN check", () => {
    expect(hasRole({ id: "1", role: "MANAGER" }, "SUPERADMIN")).toBe(false);
  });

  it("USER passes USER check", () => {
    expect(hasRole({ id: "1", role: "USER" }, "USER")).toBe(true);
  });

  it("USER fails MANAGER check", () => {
    expect(hasRole({ id: "1", role: "USER" }, "MANAGER")).toBe(false);
  });

  it("USER fails SUPERADMIN check", () => {
    expect(hasRole({ id: "1", role: "USER" }, "SUPERADMIN")).toBe(false);
  });
});

// ============================================================
// hasModuleAccess
// ============================================================
describe("hasModuleAccess", () => {
  it("returns false when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await hasModuleAccess("unknown-user", "cafe");
    expect(result).toBe(false);
  });

  it("returns true for SUPERADMIN without checking assignments", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "SUPERADMIN" } as never);
    const result = await hasModuleAccess("admin-id", "cafe");
    expect(result).toBe(true);
    expect(prisma.moduleAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for MANAGER with matching assignment", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue({ id: "assign-1" } as never);
    const result = await hasModuleAccess("manager-id", "cafe");
    expect(result).toBe(true);
  });

  it("returns false for MANAGER without assignment", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue(null);
    const result = await hasModuleAccess("manager-id", "ps-park");
    expect(result).toBe(false);
  });
});

// ============================================================
// getUserModules
// ============================================================
describe("getUserModules", () => {
  it("returns empty array when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await getUserModules("unknown");
    expect(result).toEqual([]);
  });

  it("returns all active module slugs for SUPERADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "SUPERADMIN" } as never);
    vi.mocked(prisma.module.findMany).mockResolvedValue([
      { slug: "cafe" },
      { slug: "gazebos" },
      { slug: "ps-park" },
    ] as never);
    const result = await getUserModules("admin-id");
    expect(result).toEqual(["cafe", "gazebos", "ps-park"]);
  });

  it("returns only active assigned modules for MANAGER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.moduleAssignment.findMany).mockResolvedValue([
      { module: { slug: "cafe", isActive: true } },
      { module: { slug: "gazebos", isActive: false } },
    ] as never);
    const result = await getUserModules("manager-id");
    expect(result).toEqual(["cafe"]);
  });
});

// ============================================================
// hasAdminSectionAccess
// ============================================================
describe("hasAdminSectionAccess", () => {
  it("returns false when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await hasAdminSectionAccess("unknown-user", "dashboard");
    expect(result).toBe(false);
  });

  it("returns true for SUPERADMIN without checking permissions", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "SUPERADMIN" } as never);
    const result = await hasAdminSectionAccess("admin-id", "dashboard");
    expect(result).toBe(true);
    expect(prisma.adminPermission.findUnique).not.toHaveBeenCalled();
  });

  it("returns false for USER role", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "USER" } as never);
    const result = await hasAdminSectionAccess("user-id", "dashboard");
    expect(result).toBe(false);
  });

  it("returns true for MANAGER with matching permission", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.adminPermission.findUnique).mockResolvedValue({
      id: "perm-1",
      userId: "manager-id",
      section: "cafe",
    } as never);
    const result = await hasAdminSectionAccess("manager-id", "cafe");
    expect(result).toBe(true);
  });

  it("returns false for MANAGER without permission", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.adminPermission.findUnique).mockResolvedValue(null);
    const result = await hasAdminSectionAccess("manager-id", "architect");
    expect(result).toBe(false);
  });
});

// ============================================================
// getUserAdminSections
// ============================================================
describe("getUserAdminSections", () => {
  it("returns empty array when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await getUserAdminSections("unknown");
    expect(result).toEqual([]);
  });

  it("returns empty array for USER role", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "USER" } as never);
    const result = await getUserAdminSections("user-id");
    expect(result).toEqual([]);
  });

  it("returns all section slugs for SUPERADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "SUPERADMIN" } as never);
    const result = await getUserAdminSections("admin-id");
    expect(result).toEqual(ADMIN_SECTION_SLUGS);
  });

  it("returns only granted sections for MANAGER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.adminPermission.findMany).mockResolvedValue([
      { section: "dashboard" },
      { section: "cafe" },
    ] as never);
    const result = await getUserAdminSections("manager-id");
    expect(result).toEqual(["dashboard", "cafe"]);
  });

  it("returns empty array for MANAGER with no permissions", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.adminPermission.findMany).mockResolvedValue([]);
    const result = await getUserAdminSections("manager-id");
    expect(result).toEqual([]);
  });
});

// ============================================================
// setUserAdminSections
// ============================================================
describe("setUserAdminSections", () => {
  it("calls transaction with deleteMany and createMany", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never);

    await setUserAdminSections("manager-id", ["dashboard", "cafe"]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const transactionArgs = vi.mocked(prisma.$transaction).mock.calls[0][0];
    expect(transactionArgs).toHaveLength(2); // deleteMany + createMany
  });

  it("filters out invalid section slugs", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never);

    await setUserAdminSections("manager-id", [
      "dashboard",
      "invalid-section",
      "cafe",
    ]);

    // Should still call transaction — invalid sections filtered
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("only calls deleteMany when no valid sections provided", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never);

    await setUserAdminSections("manager-id", ["invalid1", "invalid2"]);

    const transactionArgs = vi.mocked(prisma.$transaction).mock.calls[0][0];
    expect(transactionArgs).toHaveLength(1); // only deleteMany
  });
});

// ============================================================
// extractAdminSection
// ============================================================
describe("extractAdminSection", () => {
  it("extracts section from /admin/cafe", () => {
    expect(extractAdminSection("/admin/cafe")).toBe("cafe");
  });

  it("extracts section from /admin/architect/logs", () => {
    expect(extractAdminSection("/admin/architect/logs")).toBe("architect");
  });

  it("extracts section from /admin/ps-park", () => {
    expect(extractAdminSection("/admin/ps-park")).toBe("ps-park");
  });

  it("returns null for /admin root", () => {
    expect(extractAdminSection("/admin")).toBe(null);
    expect(extractAdminSection("/admin/")).toBe(null);
  });

  it("returns null for non-admin paths", () => {
    expect(extractAdminSection("/api/cafe")).toBe(null);
    expect(extractAdminSection("/")).toBe(null);
  });
});

// ============================================================
// ADMIN_SECTIONS constants
// ============================================================
describe("ADMIN_SECTIONS", () => {
  it("contains all expected sections", () => {
    const slugs = ADMIN_SECTIONS.map((s) => s.slug);
    expect(slugs).toContain("dashboard");
    expect(slugs).toContain("gazebos");
    expect(slugs).toContain("ps-park");
    expect(slugs).toContain("cafe");
    expect(slugs).toContain("rental");
    expect(slugs).toContain("modules");
    expect(slugs).toContain("users");
    expect(slugs).toContain("monitoring");
    expect(slugs).toContain("architect");
  });

  it("has labels for all sections", () => {
    ADMIN_SECTIONS.forEach((s) => {
      expect(s.label).toBeTruthy();
      expect(s.icon).toBeTruthy();
    });
  });
});
