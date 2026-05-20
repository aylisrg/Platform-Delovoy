import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  activeOfficeTenantsSegment,
  psParkGuests90dSegment,
  gazeboGuests180dSegment,
  allVerifiedUsersSegment,
} from "../segments";

function makePrisma(overrides: Partial<Record<string, unknown>> = {}): PrismaClient {
  return {
    rentalContract: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
    ...overrides,
  } as unknown as PrismaClient;
}

beforeEach(() => vi.clearAllMocks());

describe("activeOfficeTenantsSegment", () => {
  it("returns userIds matched by tenant email", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValueOnce([
      { tenant: { email: "alice@example.com" } },
      { tenant: { email: "bob@example.com" } },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u-alice" },
      { id: "u-bob" },
    ] as never);

    const result = await activeOfficeTenantsSegment(prisma);
    expect(result).toEqual(["u-alice", "u-bob"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailNormalized: { in: ["alice@example.com", "bob@example.com"] },
        }),
      })
    );
  });

  it("returns empty when no active contracts", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValueOnce([] as never);
    const result = await activeOfficeTenantsSegment(prisma);
    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("skips tenants without email", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValueOnce([
      { tenant: { email: null } },
      { tenant: { email: "valid@example.com" } },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "u-1" }] as never);

    await activeOfficeTenantsSegment(prisma);
    const call = vi.mocked(prisma.user.findMany).mock.calls[0][0] as { where: { emailNormalized: { in: string[] } } };
    expect(call.where.emailNormalized.in).toEqual(["valid@example.com"]);
  });
});

describe("psParkGuests90dSegment", () => {
  it("returns distinct userIds for ps-park bookings in last 90 days", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([
      { userId: "u-1" },
      { userId: "u-2" },
    ] as never);

    const result = await psParkGuests90dSegment(prisma);
    expect(result).toEqual(["u-1", "u-2"]);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ moduleSlug: "ps-park" }),
        distinct: ["userId"],
      })
    );
  });

  it("returns empty when no bookings", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([] as never);
    const result = await psParkGuests90dSegment(prisma);
    expect(result).toEqual([]);
  });
});

describe("gazeboGuests180dSegment", () => {
  it("queries moduleSlug=gazebos with 180d window", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([{ userId: "u-3" }] as never);

    const result = await gazeboGuests180dSegment(prisma);
    expect(result).toEqual(["u-3"]);

    const call = vi.mocked(prisma.booking.findMany).mock.calls[0][0] as { where: { moduleSlug: string; createdAt: { gte: Date } } };
    expect(call.where.moduleSlug).toBe("gazebos");
    const msInDay = 24 * 60 * 60 * 1000;
    const expectedSince = Date.now() - 180 * msInDay;
    expect(Math.abs(call.where.createdAt.gte.getTime() - expectedSince)).toBeLessThan(5000);
  });
});

describe("allVerifiedUsersSegment", () => {
  it("returns verified USER ids", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u-a" },
      { id: "u-b" },
    ] as never);

    const result = await allVerifiedUsersSegment(prisma);
    expect(result).toEqual(["u-a", "u-b"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "USER",
          emailVerified: { not: null },
          mergedIntoUserId: null,
        }),
      })
    );
  });
});
