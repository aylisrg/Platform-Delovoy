import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    office: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    rentalContract: { findMany: vi.fn() },
    rentalDeal: { findMany: vi.fn() },
    rentalInquiry: { findMany: vi.fn() },
  },
}));

import { listOffices } from "@/modules/rental/service";
import { prisma } from "@/lib/db";

beforeEach(() => vi.clearAllMocks());

describe("park-scope isolation", () => {
  it("listOffices defaults to delovoy parkSlug", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([]);
    await listOffices();
    expect(prisma.office.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parkSlug: "delovoy" }),
      })
    );
  });

  it("listOffices respects explicit parkSlug filter", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([]);
    await listOffices({ parkSlug: "nedelovoy" });
    expect(prisma.office.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parkSlug: "nedelovoy" }),
      })
    );
  });

  it("listOffices with delovoy filter does not leak nedelovoy data", async () => {
    const delovoyOffice = { id: "o1", parkSlug: "delovoy", number: "101" };
    vi.mocked(prisma.office.findMany).mockResolvedValue([delovoyOffice] as never);
    const result = await listOffices({ parkSlug: "delovoy" });
    expect(result).toHaveLength(1);
    expect(result[0].parkSlug).toBe("delovoy");
    const call = vi.mocked(prisma.office.findMany).mock.calls[0][0] as { where: { parkSlug: string } };
    expect(call.where.parkSlug).toBe("delovoy");
  });
});
