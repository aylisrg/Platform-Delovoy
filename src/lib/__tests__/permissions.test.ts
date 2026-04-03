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
  },
}));

import { hasRole, hasModuleAccess, getUserModules } from "@/lib/permissions";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

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
