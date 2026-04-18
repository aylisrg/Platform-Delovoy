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
  getModuleAdmins,
  canConfirmReceipt,
  canCorrectReceipt,
  canFlagProblem,
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

  it("ADMIN passes ADMIN check", () => {
    expect(hasRole({ id: "1", role: "ADMIN" }, "ADMIN")).toBe(true);
  });

  it("ADMIN passes MANAGER check", () => {
    expect(hasRole({ id: "1", role: "ADMIN" }, "MANAGER")).toBe(true);
  });

  it("ADMIN passes USER check", () => {
    expect(hasRole({ id: "1", role: "ADMIN" }, "USER")).toBe(true);
  });

  it("ADMIN fails SUPERADMIN check", () => {
    expect(hasRole({ id: "1", role: "ADMIN" }, "SUPERADMIN")).toBe(false);
  });

  it("MANAGER fails ADMIN check", () => {
    expect(hasRole({ id: "1", role: "MANAGER" }, "ADMIN")).toBe(false);
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

// ============================================================
// getModuleAdmins
// ============================================================
describe("getModuleAdmins", () => {
  it("returns admins assigned to the module", async () => {
    vi.mocked(prisma.moduleAssignment.findMany).mockResolvedValue([
      { user: { id: "a1", name: "Алексей", telegramId: "123" } },
      { user: { id: "a2", name: "Мария", telegramId: null } },
    ] as never);

    const result = await getModuleAdmins("cafe");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a1");
    expect(result[1].telegramId).toBeNull();
  });

  it("returns empty array when no admins assigned", async () => {
    vi.mocked(prisma.moduleAssignment.findMany).mockResolvedValue([]);

    const result = await getModuleAdmins("ps-park");
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// canConfirmReceipt
// ============================================================
describe("canConfirmReceipt", () => {
  it("returns true for SUPERADMIN without checking module access", async () => {
    const result = await canConfirmReceipt({ id: "sa", role: "SUPERADMIN" }, "cafe");
    expect(result).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns false for MANAGER role", async () => {
    const result = await canConfirmReceipt({ id: "m1", role: "MANAGER" }, "cafe");
    expect(result).toBe(false);
  });

  it("returns false for USER role", async () => {
    const result = await canConfirmReceipt({ id: "u1", role: "USER" }, "cafe");
    expect(result).toBe(false);
  });

  it("returns true for ADMIN with module access", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue({ id: "assign-1" } as never);

    const result = await canConfirmReceipt({ id: "a1", role: "ADMIN" }, "cafe");
    expect(result).toBe(true);
  });

  it("returns false for ADMIN without module access", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue(null);

    const result = await canConfirmReceipt({ id: "a1", role: "ADMIN" }, "bbq");
    expect(result).toBe(false);
  });
});

// ============================================================
// canCorrectReceipt
// ============================================================
describe("canCorrectReceipt", () => {
  it("delegates to canConfirmReceipt — SUPERADMIN returns true", async () => {
    const result = await canCorrectReceipt({ id: "sa", role: "SUPERADMIN" }, "ps-park");
    expect(result).toBe(true);
  });

  it("delegates to canConfirmReceipt — MANAGER returns false", async () => {
    const result = await canCorrectReceipt({ id: "m1", role: "MANAGER" }, "cafe");
    expect(result).toBe(false);
  });

  it("delegates to canConfirmReceipt — ADMIN with access returns true", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue({ id: "a" } as never);

    const result = await canCorrectReceipt({ id: "a1", role: "ADMIN" }, "cafe");
    expect(result).toBe(true);
  });
});

// ============================================================
// canFlagProblem
// ============================================================
describe("canFlagProblem", () => {
  it("SUPERADMIN can flag any receipt", async () => {
    const result = await canFlagProblem({ id: "sa", role: "SUPERADMIN" }, "cafe", "other-user");
    expect(result).toBe(true);
  });

  it("ADMIN with module access can flag any receipt in the module", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue({ id: "a" } as never);

    const result = await canFlagProblem({ id: "a1", role: "ADMIN" }, "cafe", "some-manager");
    expect(result).toBe(true);
  });

  it("ADMIN without module access cannot flag", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue(null);

    const result = await canFlagProblem({ id: "a1", role: "ADMIN" }, "bbq", "some-manager");
    expect(result).toBe(false);
  });

  it("MANAGER can flag their own receipt with module access", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "MANAGER" } as never);
    vi.mocked(prisma.moduleAssignment.findFirst).mockResolvedValue({ id: "a" } as never);

    const result = await canFlagProblem({ id: "m1", role: "MANAGER" }, "cafe", "m1");
    expect(result).toBe(true);
  });

  it("MANAGER cannot flag another manager's receipt", async () => {
    const result = await canFlagProblem({ id: "m1", role: "MANAGER" }, "cafe", "m2");
    expect(result).toBe(false);
  });

  it("USER cannot flag any receipt", async () => {
    const result = await canFlagProblem({ id: "u1", role: "USER" }, "cafe", "u1");
    expect(result).toBe(false);
  });
});
