import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCheckInMetadata, buildNoShowMetadata } from "../checkin";

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
    },
  },
}));

import { findAutoNoShowCandidates } from "../checkin";
import { prisma } from "@/lib/db";

describe("buildCheckInMetadata", () => {
  it("builds correct metadata with managerId and timestamp", () => {
    const now = new Date("2030-08-20T12:05:00Z");
    const result = buildCheckInMetadata("manager-1", now);
    expect(result.checkedInAt).toBe("2030-08-20T12:05:00.000Z");
    expect(result.checkedInBy).toBe("manager-1");
  });
});

describe("buildNoShowMetadata", () => {
  it("builds auto no-show metadata", () => {
    const now = new Date("2030-08-20T12:32:00Z");
    const result = buildNoShowMetadata("auto", now);
    expect(result.noShowAt).toBe("2030-08-20T12:32:00.000Z");
    expect(result.noShowReason).toBe("auto");
  });

  it("builds manual no-show metadata", () => {
    const now = new Date("2030-08-20T12:32:00Z");
    const result = buildNoShowMetadata("manual", now);
    expect(result.noShowReason).toBe("manual");
  });
});

describe("findAutoNoShowCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries confirmed bookings past threshold and returns IDs", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      { id: "b1" },
      { id: "b2" },
    ] as never);

    const result = await findAutoNoShowCandidates("ps-park", 30);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          moduleSlug: "ps-park",
          status: "CONFIRMED",
        }),
        select: { id: true },
      })
    );
    expect(result).toEqual(["b1", "b2"]);
  });

  it("returns empty array when no candidates", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    const result = await findAutoNoShowCandidates("gazebos", 30);
    expect(result).toEqual([]);
  });
});
