import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedNedelovoyGrants } from "../nedelovoy-grants";

function makePrisma() {
  return {
    user: { findMany: vi.fn().mockResolvedValue([{ id: "sa1" }]) },
    module: { findUnique: vi.fn().mockResolvedValue({ id: "mod-ned" }) },
    adminPermission: { upsert: vi.fn().mockResolvedValue({}) },
    moduleAssignment: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

describe("seedNedelovoyGrants", () => {
  it("grants only current, non-merged SUPERADMINs (excluded / merged accounts stay revoked)", async () => {
    const prisma = makePrisma();
    await seedNedelovoyGrants(prisma as unknown as PrismaClient);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: "SUPERADMIN", mergedIntoUserId: null },
      select: { id: true },
    });
    expect(prisma.adminPermission.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.moduleAssignment.upsert).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without SUPERADMINs", async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([]);
    await seedNedelovoyGrants(prisma as unknown as PrismaClient);
    expect(prisma.adminPermission.upsert).not.toHaveBeenCalled();
  });
});
