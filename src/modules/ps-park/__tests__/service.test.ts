import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
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
  },
}));

import {
  createBooking,
  updateBookingStatus,
  cancelBooking,
  getAvailability,
} from "@/modules/ps-park/service";
import { prisma } from "@/lib/db";

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
          metadata: { playerCount: 2, comment: "Турнир" },
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
      expect.objectContaining({ data: { status: "COMPLETED" } })
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
      expect.objectContaining({ data: { status: "CANCELLED" } })
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

  it("returns correct slot labels (first: 10:00, last: 22:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result[0].slots;

    expect(slots[0].startTime).toBe("10:00");
    expect(slots[0].endTime).toBe("11:00");
    expect(slots[slots.length - 1].startTime).toBe("22:00");
    expect(slots[slots.length - 1].endTime).toBe("23:00");
  });
});
