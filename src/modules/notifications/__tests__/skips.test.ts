import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { notificationDeliverySkip: { create: vi.fn(), createMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { recordSkip, recordSkips } from "../skips";

beforeEach(() => vi.clearAllMocks());

describe("delivery skips (AC-D4.3)", () => {
  it("records catalog (staff) events with the reason", async () => {
    await recordSkip({ userId: "u1", eventType: "booking.created", entityType: "Booking", entityId: "b1", reason: "NO_CHANNEL" });
    expect(prisma.notificationDeliverySkip.create).toHaveBeenCalledWith({
      data: { userId: "u1", eventType: "booking.created", entityType: "Booking", entityId: "b1", reason: "NO_CHANNEL" },
    });
  });

  it("ignores non-catalog events (client notifications, broadcasts)", async () => {
    await recordSkip({ userId: "u1", eventType: "booking.reminder", reason: "DND" });
    await recordSkips([{ userId: "u1", eventType: "BROADCAST", reason: "OPTED_OUT" }]);
    expect(prisma.notificationDeliverySkip.create).not.toHaveBeenCalled();
    expect(prisma.notificationDeliverySkip.createMany).not.toHaveBeenCalled();
  });

  it("batch insert filters to catalog events and never throws", async () => {
    vi.mocked(prisma.notificationDeliverySkip.createMany).mockRejectedValueOnce(new Error("db"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordSkips([
        { userId: "u1", eventType: "avito.lead.new", reason: "OPTED_OUT" },
        { userId: "u2", eventType: "x.y", reason: "OPTED_OUT" },
      ]),
    ).resolves.toBeUndefined();
    expect(prisma.notificationDeliverySkip.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", eventType: "avito.lead.new", entityType: null, entityId: null, reason: "OPTED_OUT" }],
    });
  });
});
