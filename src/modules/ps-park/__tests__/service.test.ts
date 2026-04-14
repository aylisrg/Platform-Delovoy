import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/modules/inventory/service", () => ({
  validateAndSnapshotItems: vi.fn(),
  saleBookingItems: vi.fn(),
  returnBookingItems: vi.fn(),
}));

vi.mock("@/lib/google-calendar", () => ({
  createCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    resource: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import {
  createBooking,
  updateBookingStatus,
  cancelBooking,
  getAvailability,
  addItemsToBooking,
  getTimeline,
  getActiveSessions,
  extendBooking,
  getBookingBill,
  checkInBooking,
  markNoShow,
} from "@/modules/ps-park/service";
import { prisma } from "@/lib/db";
import { validateAndSnapshotItems, saleBookingItems } from "@/modules/inventory/service";

const FUTURE_DATE = "2030-08-20";
const PAST_DATE = "2020-03-01";

const mockTable = (overrides = {}) => ({
  id: "table-1",
  name: "PlayStation стол №1",
  moduleSlug: "ps-park",
  isActive: true,
  capacity: 4,
  pricePerHour: 300,
  ...overrides,
});

const mockBooking = (overrides = {}) => ({
  id: "booking-1",
  userId: "user-1",
  resourceId: "table-1",
  moduleSlug: "ps-park",
  status: "PENDING",
  date: new Date(FUTURE_DATE),
  startTime: new Date(`${FUTURE_DATE}T12:00:00`),
  endTime: new Date(`${FUTURE_DATE}T13:00:00`),
  metadata: {},
  ...overrides,
});

const validBookingInput = {
  resourceId: "table-1",
  date: FUTURE_DATE,
  startTime: "12:00",
  endTime: "13:00",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ===== createBooking =====

describe("createBooking", () => {
  it("creates booking successfully when table is available", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    const result = await createBooking("user-1", validBookingInput);

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          resourceId: "table-1",
          status: "PENDING",
          moduleSlug: "ps-park",
        }),
      })
    );
    expect(result).toBeDefined();
  });

  it("throws RESOURCE_NOT_FOUND when table does not exist", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(null);

    await expect(createBooking("user-1", validBookingInput)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("throws CAPACITY_EXCEEDED when playerCount exceeds table capacity", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(
      mockTable({ capacity: 2 }) as never
    );

    await expect(
      createBooking("user-1", { ...validBookingInput, playerCount: 5 })
    ).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
  });

  it("throws DATE_IN_PAST for a past date", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);

    await expect(
      createBooking("user-1", { ...validBookingInput, date: PAST_DATE })
    ).rejects.toMatchObject({ code: "DATE_IN_PAST" });
  });

  it("throws BOOKING_CONFLICT when slot is already taken", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(mockBooking() as never);

    await expect(createBooking("user-1", validBookingInput)).rejects.toMatchObject({
      code: "BOOKING_CONFLICT",
    });
  });

  it("stores playerCount and comment in metadata", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", {
      ...validBookingInput,
      playerCount: 2,
      comment: "Турнир",
    });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ playerCount: 2, comment: "Турнир" }),
        }),
      })
    );
  });
});

// ===== updateBookingStatus =====

describe("updateBookingStatus", () => {
  it("transitions PENDING → CONFIRMED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "PENDING" }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "CONFIRMED" }) as never
    );

    await updateBookingStatus("booking-1", "CONFIRMED");
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONFIRMED" } })
    );
  });

  it("transitions CONFIRMED → COMPLETED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED" }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );

    await updateBookingStatus("booking-1", "COMPLETED");
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });

  it("throws INVALID_STATUS_TRANSITION for CANCELLED → CONFIRMED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CANCELLED" }) as never
    );

    await expect(updateBookingStatus("booking-1", "CONFIRMED")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws BOOKING_NOT_FOUND when booking does not exist", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(updateBookingStatus("nonexistent", "CONFIRMED")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });
});

// ===== cancelBooking =====

describe("cancelBooking", () => {
  it("cancels booking by its owner", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ userId: "user-1", status: "PENDING" }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "CANCELLED" }) as never
    );

    await cancelBooking("booking-1", "user-1");
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) })
    );
  });

  it("throws FORBIDDEN for non-owner", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ userId: "user-1", status: "PENDING" }) as never
    );

    await expect(cancelBooking("booking-1", "other-user")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws INVALID_STATUS_TRANSITION for COMPLETED booking", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ userId: "user-1", status: "COMPLETED" }) as never
    );

    await expect(cancelBooking("booking-1", "user-1")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws BOOKING_NOT_FOUND when not found", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(cancelBooking("nonexistent", "user-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });
});

// ===== addItemsToBooking =====

describe("addItemsToBooking", () => {
  const newItems = [{ skuId: "sku-1", quantity: 2 }];
  const snapshot = { skuId: "sku-1", skuName: "Cola", quantity: 2, priceAtBooking: 150 };

  it("adds items to a PENDING booking (snapshot only, no transaction)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "PENDING", metadata: {} }) as never
    );
    vi.mocked(validateAndSnapshotItems).mockResolvedValue({
      snapshots: [snapshot],
      itemsTotal: 300,
    } as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking() as never);

    await addItemsToBooking("booking-1", "manager-1", newItems);

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "booking-1" } })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("uses a transaction to deduct stock for CONFIRMED booking", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", metadata: {} }) as never
    );
    vi.mocked(validateAndSnapshotItems).mockResolvedValue({
      snapshots: [snapshot],
      itemsTotal: 300,
    } as never);
    const updatedBooking = mockBooking({ status: "CONFIRMED" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        booking: { update: vi.fn().mockResolvedValue(updatedBooking) },
      };
      return fn(mockTx);
    });

    await addItemsToBooking("booking-1", "manager-1", newItems);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(saleBookingItems).toHaveBeenCalled();
  });

  it("merges quantities when the same SKU already exists in metadata", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "PENDING",
        metadata: {
          items: [{ skuId: "sku-1", skuName: "Cola", quantity: 1, priceAtBooking: 150 }],
          itemsTotal: "150.00",
        },
      }) as never
    );
    vi.mocked(validateAndSnapshotItems).mockResolvedValue({
      snapshots: [{ ...snapshot, quantity: 2 }],
      itemsTotal: 300,
    } as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking() as never);

    await addItemsToBooking("booking-1", "manager-1", newItems);

    const updateCall = vi.mocked(prisma.booking.update).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = (updateCall as unknown as { data: { metadata: { items: { skuId: string; quantity: number }[] } } }).data.metadata;
    const mergedItem = metadata.items.find((i: { skuId: string }) => i.skuId === "sku-1");
    expect(mergedItem?.quantity).toBe(3); // 1 existing + 2 new
  });

  it("throws BOOKING_NOT_FOUND for unknown booking", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(addItemsToBooking("bad-id", "manager-1", newItems)).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });

  it("throws INVALID_STATUS for COMPLETED booking", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );

    await expect(addItemsToBooking("booking-1", "manager-1", newItems)).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });

  it("throws INVALID_STATUS for CANCELLED booking", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CANCELLED" }) as never
    );

    await expect(addItemsToBooking("booking-1", "manager-1", newItems)).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

// ===== getTimeline =====

describe("getTimeline", () => {
  it("returns resources, bookings, and 15 hours array", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      {
        id: "b-1",
        resourceId: "table-1",
        startTime: new Date(`${FUTURE_DATE}T10:00:00`),
        endTime: new Date(`${FUTURE_DATE}T12:00:00`),
        status: "CONFIRMED",
        clientName: "Иван",
        clientPhone: "+79001234567",
        metadata: {},
      },
    ] as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.date).toBe(FUTURE_DATE);
    expect(result.resources).toHaveLength(1);
    expect(result.bookings).toHaveLength(1);
    expect(result.hours).toHaveLength(15);
    expect(result.hours[0]).toBe("08:00");
    expect(result.hours[14]).toBe("22:00");
  });

  it("returns empty bookings when none exist", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getTimeline(FUTURE_DATE);
    expect(result.bookings).toHaveLength(0);
  });

  it("serializes booking times to ISO strings", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      {
        id: "b-1",
        resourceId: "table-1",
        startTime: new Date(`${FUTURE_DATE}T10:00:00`),
        endTime: new Date(`${FUTURE_DATE}T12:00:00`),
        status: "CONFIRMED",
        clientName: null,
        clientPhone: null,
        metadata: null,
      },
    ] as never);

    const result = await getTimeline(FUTURE_DATE);
    expect(result.bookings[0].startTime).toContain(FUTURE_DATE);
    expect(typeof result.bookings[0].startTime).toBe("string");
  });
});

// ===== getActiveSessions =====

describe("getActiveSessions", () => {
  it("returns empty array when no active sessions", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([]);

    const result = await getActiveSessions();
    expect(result).toHaveLength(0);
  });

  it("calculates bill summary correctly", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago
    const end = new Date(now.getTime() + 30 * 60 * 1000); // 30 min from now

    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      {
        id: "b-active",
        resourceId: "table-1",
        status: "CONFIRMED",
        date: new Date(now.toISOString().split("T")[0]),
        startTime: start,
        endTime: end,
        clientName: "Иван",
        clientPhone: "+79001234567",
        userId: "user-1",
        metadata: {
          items: [{ skuId: "sku-1", skuName: "Cola", quantity: 2, priceAtBooking: "150" }],
          itemsTotal: "300",
        },
      },
    ] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      mockTable({ pricePerHour: 500 }),
    ] as never);

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].pricePerHour).toBe(500);
    expect(result[0].hoursBooked).toBe(1);
    expect(result[0].hoursCost).toBe(500);
    expect(result[0].itemsTotal).toBe(300);
    expect(result[0].totalBill).toBe(800);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].subtotal).toBe(300);
  });
});

// ===== extendBooking =====

describe("extendBooking", () => {
  it("extends booking endTime by 1 hour when next slot is free", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({
          status: "CONFIRMED",
          endTime: new Date(`${FUTURE_DATE}T13:00:00`),
        }) as never
      )
      .mockResolvedValueOnce(null); // no conflict

    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ endTime: new Date(`${FUTURE_DATE}T14:00:00`) }) as never
    );

    const result = await extendBooking("booking-1", "manager-1");

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endTime: new Date(`${FUTURE_DATE}T14:00:00`),
        }),
      })
    );
    expect(result).toBeDefined();
  });

  it("throws BOOKING_NOT_FOUND when booking does not exist", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(extendBooking("bad-id", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });

  it("throws INVALID_STATUS when booking is not CONFIRMED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "PENDING" }) as never
    );

    await expect(extendBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });

  it("throws BEYOND_CLOSING when extension would go past 23:00", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        endTime: new Date(`${FUTURE_DATE}T23:00:00`),
      }) as never
    );

    await expect(extendBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BEYOND_CLOSING",
    });
  });

  it("throws BOOKING_CONFLICT when next slot is occupied", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({
          status: "CONFIRMED",
          endTime: new Date(`${FUTURE_DATE}T13:00:00`),
        }) as never
      )
      .mockResolvedValueOnce(
        mockBooking({ id: "other-booking" }) as never
      ); // conflict

    await expect(extendBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_CONFLICT",
    });
  });
});

// ===== getBookingBill =====

describe("getBookingBill", () => {
  it("calculates bill correctly", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        startTime: new Date(`${FUTURE_DATE}T10:00:00`),
        endTime: new Date(`${FUTURE_DATE}T12:00:00`),
        clientName: "Иван",
        metadata: {
          items: [
            { skuId: "sku-1", skuName: "Cola", quantity: 2, priceAtBooking: "80" },
            { skuId: "sku-2", skuName: "Chips", quantity: 1, priceAtBooking: "190" },
          ],
          itemsTotal: "350",
        },
      }) as never
    );
    vi.mocked(prisma.resource.findUnique).mockResolvedValue(
      mockTable({ pricePerHour: 500 }) as never
    );

    const bill = await getBookingBill("booking-1");

    expect(bill.hoursBooked).toBe(2);
    expect(bill.pricePerHour).toBe(500);
    expect(bill.hoursCost).toBe(1000);
    expect(bill.items).toHaveLength(2);
    expect(bill.items[0].subtotal).toBe(160); // 2 x 80
    expect(bill.items[1].subtotal).toBe(190); // 1 x 190
    expect(bill.itemsTotal).toBe(350);
    expect(bill.totalBill).toBe(1350);
    expect(bill.clientName).toBe("Иван");
  });

  it("returns 0 for items when no items in metadata", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        startTime: new Date(`${FUTURE_DATE}T10:00:00`),
        endTime: new Date(`${FUTURE_DATE}T11:00:00`),
        metadata: {},
      }) as never
    );
    vi.mocked(prisma.resource.findUnique).mockResolvedValue(
      mockTable({ pricePerHour: 300 }) as never
    );

    const bill = await getBookingBill("booking-1");
    expect(bill.items).toHaveLength(0);
    expect(bill.itemsTotal).toBe(0);
    expect(bill.totalBill).toBe(300);
  });

  it("throws BOOKING_NOT_FOUND when booking does not exist", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(getBookingBill("bad-id")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });
});

// ===== checkInBooking =====

describe("checkInBooking", () => {
  it("transitions CONFIRMED → CHECKED_IN and stores checkedInAt/By in metadata", async () => {
    const pastStart = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", startTime: pastStart }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "CHECKED_IN" }) as never
    );

    await checkInBooking("booking-1", "manager-1");

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CHECKED_IN",
          managerId: "manager-1",
          metadata: expect.objectContaining({
            checkedInBy: "manager-1",
          }),
        }),
      })
    );
  });

  it("transitions NO_SHOW → CHECKED_IN (late arrival), stores lateCheckedInAt", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "NO_SHOW",
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        metadata: { noShowAt: new Date().toISOString(), noShowReason: "auto" },
      }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "CHECKED_IN" }) as never
    );

    await checkInBooking("booking-1", "manager-1");

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CHECKED_IN",
          metadata: expect.objectContaining({ lateCheckedInAt: expect.any(String) }),
        }),
      })
    );
  });

  it("throws BOOKING_NOT_FOUND when booking does not exist", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    await expect(checkInBooking("bad-id", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });

  it("throws TRANSITION_CONDITION_NOT_MET when startTime is in the future", async () => {
    const futureStart = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", startTime: futureStart }) as never
    );
    await expect(checkInBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "TRANSITION_CONDITION_NOT_MET",
    });
  });
});

// ===== markNoShow =====

describe("markNoShow", () => {
  it("transitions CONFIRMED → NO_SHOW when 30+ min past startTime", async () => {
    const oldStart = new Date(Date.now() - 35 * 60 * 1000); // 35 min ago
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", startTime: oldStart }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "NO_SHOW" }) as never
    );

    await markNoShow("booking-1", "manager-1", "manual");

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NO_SHOW",
          metadata: expect.objectContaining({
            noShowReason: "manual",
            noShowBy: "manager-1",
          }),
        }),
      })
    );
  });

  it("throws TRANSITION_CONDITION_NOT_MET when < 30 min past startTime", async () => {
    const recentStart = new Date(Date.now() - 20 * 60 * 1000); // only 20 min ago
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", startTime: recentStart }) as never
    );
    await expect(markNoShow("booking-1", "manager-1", "manual")).rejects.toMatchObject({
      code: "TRANSITION_CONDITION_NOT_MET",
    });
  });

  it("throws BOOKING_NOT_FOUND when booking does not exist", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    await expect(markNoShow("bad-id", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });
});

// ===== getAvailability =====

describe("getAvailability", () => {
  it("returns 15 slots per table (08:00–23:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].slots).toHaveLength(15); // hours 08,09,...,22 = 15 slots
  });

  it("marks all slots available when no bookings exist", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);
    expect(result[0].slots.every((s) => s.isAvailable)).toBe(true);
  });

  it("marks slot as unavailable when overlapping booking exists", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      mockBooking({
        startTime: new Date(`${FUTURE_DATE}T12:00:00`),
        endTime: new Date(`${FUTURE_DATE}T13:00:00`),
        status: "PENDING",
      }),
    ] as never);

    const result = await getAvailability(FUTURE_DATE);
    const slot12 = result[0].slots.find((s) => s.startTime === "12:00");
    expect(slot12?.isAvailable).toBe(false);
  });

  it("returns correct slot labels (first: 08:00, last: 22:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result[0].slots;

    expect(slots[0].startTime).toBe("08:00");
    expect(slots[0].endTime).toBe("09:00");
    expect(slots[slots.length - 1].startTime).toBe("22:00");
    expect(slots[slots.length - 1].endTime).toBe("23:00");
  });
});
