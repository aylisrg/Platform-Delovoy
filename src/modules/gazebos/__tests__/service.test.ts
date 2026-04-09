import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    resource: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
  createAdminBooking,
  updateBookingStatus,
  cancelBooking,
  getAvailability,
} from "@/modules/gazebos/service";
import { prisma } from "@/lib/db";

// Future date safe for all tests
const FUTURE_DATE = "2030-06-15";
const PAST_DATE = "2020-01-01";

const mockResource = (overrides = {}) => ({
  id: "resource-1",
  name: "Беседка №1",
  moduleSlug: "gazebos",
  isActive: true,
  capacity: 10,
  pricePerHour: 500,
  ...overrides,
});

const mockBooking = (overrides = {}) => ({
  id: "booking-1",
  userId: "user-1",
  resourceId: "resource-1",
  moduleSlug: "gazebos",
  status: "PENDING",
  date: new Date(FUTURE_DATE),
  startTime: new Date(`${FUTURE_DATE}T10:00:00`),
  endTime: new Date(`${FUTURE_DATE}T11:00:00`),
  metadata: {},
  ...overrides,
});

const validBookingInput = {
  resourceId: "resource-1",
  date: FUTURE_DATE,
  startTime: "10:00",
  endTime: "11:00",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ===== createBooking =====

describe("createBooking", () => {
  it("creates booking when resource is available and input is valid", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null); // no conflict
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    const result = await createBooking("user-1", validBookingInput);

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          resourceId: "resource-1",
          status: "PENDING",
          moduleSlug: "gazebos",
        }),
      })
    );
    expect(result).toBeDefined();
  });

  it("throws RESOURCE_NOT_FOUND when resource does not exist or is inactive", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(null);

    await expect(createBooking("user-1", validBookingInput)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("throws CAPACITY_EXCEEDED when guestCount exceeds capacity", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(
      mockResource({ capacity: 5 }) as never
    );

    await expect(
      createBooking("user-1", { ...validBookingInput, guestCount: 10 })
    ).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
  });

  it("throws DATE_IN_PAST for a past date", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(
      createBooking("user-1", { ...validBookingInput, date: PAST_DATE })
    ).rejects.toMatchObject({ code: "DATE_IN_PAST" });
  });

  it("throws BOOKING_CONFLICT when time slot is already taken", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(mockBooking() as never); // conflict exists

    await expect(createBooking("user-1", validBookingInput)).rejects.toMatchObject({
      code: "BOOKING_CONFLICT",
    });
  });

  it("stores guestCount and comment in metadata", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", {
      ...validBookingInput,
      guestCount: 4,
      comment: "День рождения",
    });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: { guestCount: 4, comment: "День рождения" },
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

  it("transitions PENDING → CANCELLED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "PENDING" }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ status: "CANCELLED" }) as never
    );

    await updateBookingStatus("booking-1", "CANCELLED");
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } })
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

  it("throws INVALID_STATUS_TRANSITION for CONFIRMED → PENDING", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED" }) as never
    );

    await expect(updateBookingStatus("booking-1", "PENDING")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws INVALID_STATUS_TRANSITION for COMPLETED → CANCELLED (terminal)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );

    await expect(updateBookingStatus("booking-1", "CANCELLED")).rejects.toMatchObject({
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
  it("cancels a PENDING booking by its owner", async () => {
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

  it("throws FORBIDDEN when user is not the booking owner", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ userId: "user-1", status: "PENDING" }) as never
    );

    await expect(cancelBooking("booking-1", "other-user")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws INVALID_STATUS_TRANSITION when booking is already CANCELLED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ userId: "user-1", status: "CANCELLED" }) as never
    );

    await expect(cancelBooking("booking-1", "user-1")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws INVALID_STATUS_TRANSITION when booking is COMPLETED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ userId: "user-1", status: "COMPLETED" }) as never
    );

    await expect(cancelBooking("booking-1", "user-1")).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("throws BOOKING_NOT_FOUND when booking does not exist", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(cancelBooking("nonexistent", "user-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });
});

// ===== getAvailability =====

describe("getAvailability", () => {
  it("returns 13 slots per resource (9:00–22:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]); // no bookings

    const result = await getAvailability(FUTURE_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].slots).toHaveLength(13); // hours 9,10,11,...,21 = 13 slots
  });

  it("marks all slots as available when no bookings exist", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);

    expect(result[0].slots.every((s) => s.isAvailable)).toBe(true);
  });

  it("marks slot as unavailable when a booking overlaps", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      mockBooking({
        startTime: new Date(`${FUTURE_DATE}T10:00:00`),
        endTime: new Date(`${FUTURE_DATE}T11:00:00`),
        status: "CONFIRMED",
      }),
    ] as never);

    const result = await getAvailability(FUTURE_DATE);
    const slot10 = result[0].slots.find((s) => s.startTime === "10:00");

    expect(slot10?.isAvailable).toBe(false);
  });

  it("returns correct slot time labels (first: 09:00, last: 21:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result[0].slots;

    expect(slots[0].startTime).toBe("09:00");
    expect(slots[0].endTime).toBe("10:00");
    expect(slots[slots.length - 1].startTime).toBe("21:00");
    expect(slots[slots.length - 1].endTime).toBe("22:00");
  });

  it("filters by resourceId when provided", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    await getAvailability(FUTURE_DATE, "resource-1");

    expect(prisma.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "resource-1" }),
      })
    );
  });
});

// === ADMIN BOOKING ===

const validAdminInput = {
  resourceId: "resource-1",
  date: FUTURE_DATE,
  startTime: "10:00",
  endTime: "12:00",
  clientName: "Иванов Иван",
  clientPhone: "+7 999 123-45-67",
};

describe("createAdminBooking", () => {
  it("should create a confirmed booking with client info in metadata", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", metadata: { clientName: "Иванов Иван", clientPhone: "+7 999 123-45-67", bookedByAdmin: true } }) as never
    );

    const result = await createAdminBooking("admin-1", validAdminInput);

    expect(result.status).toBe("CONFIRMED");
    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          userId: "admin-1",
          metadata: expect.objectContaining({
            clientName: "Иванов Иван",
            clientPhone: "+7 999 123-45-67",
            bookedByAdmin: true,
          }),
        }),
      })
    );
  });

  it("should reject if resource not found", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(null as never);

    await expect(createAdminBooking("admin-1", validAdminInput))
      .rejects.toThrow("Беседка не найдена или неактивна");
  });

  it("should reject if time slot is conflicting", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(mockBooking() as never);

    await expect(createAdminBooking("admin-1", validAdminInput))
      .rejects.toThrow("Это время уже занято");
  });

  it("should reject past dates", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(createAdminBooking("admin-1", { ...validAdminInput, date: PAST_DATE }))
      .rejects.toThrow("Нельзя бронировать на прошедшую дату");
  });

  it("should store guest count and comment in metadata", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED" }) as never);

    await createAdminBooking("admin-1", {
      ...validAdminInput,
      guestCount: 5,
      comment: "VIP клиент",
    });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            guestCount: 5,
            comment: "VIP клиент",
          }),
        }),
      })
    );
  });
});
