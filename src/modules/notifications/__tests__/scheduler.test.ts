import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findMany: vi.fn() },
    notificationLog: { findFirst: vi.fn(), create: vi.fn() },
    resource: { findUnique: vi.fn() },
    rentalContract: { findMany: vi.fn() },
  },
}));

vi.mock("../queue", () => ({
  enqueueNotification: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { enqueueNotification } from "../queue";
import { processScheduledNotifications } from "../scheduler";

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    userId: "u1",
    moduleSlug: "gazebos",
    resourceId: "r1",
    status: "CONFIRMED",
    date: new Date("2026-07-08T00:00:00"),
    startTime: new Date("2026-07-08T12:00:00"),
    endTime: new Date("2026-07-08T16:00:00"),
    user: { name: "Иванов" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([]);
  vi.mocked(prisma.notificationLog.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.notificationLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.resource.findUnique).mockResolvedValue({
    name: "Беседка №1",
  } as never);
});

describe("processBookingReminders", () => {
  it("enqueues a reminder for a registered-user booking", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      makeBooking(),
    ] as never);

    await processScheduledNotifications();

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.reminder",
        moduleSlug: "gazebos",
        entityId: "b1",
        userId: "u1",
        data: expect.objectContaining({
          resourceName: "Беседка №1",
          endTime: expect.any(String),
        }),
      })
    );
    // User bookings get their SENT log from the client delivery path.
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it("enqueues a reminder for a guest booking and writes a SENT marker", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      makeBooking({ userId: null, user: null }),
    ] as never);

    await processScheduledNotifications();

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.reminder",
        entityId: "b1",
        userId: undefined,
      })
    );
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: "TELEGRAM",
        eventType: "booking.reminder",
        moduleSlug: "gazebos",
        entityId: "b1",
        recipient: "module-channel",
        status: "SENT",
      }),
    });
  });

  it("skips a booking whose reminder was already sent (idempotency)", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      makeBooking({ userId: null, user: null }),
    ] as never);
    vi.mocked(prisma.notificationLog.findFirst).mockResolvedValue({
      id: "log1",
    } as never);

    await processScheduledNotifications();

    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });
});
