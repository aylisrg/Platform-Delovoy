import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/lib/google-calendar", () => ({
  createCalendarEvent: vi.fn().mockResolvedValue({ success: false }),
  deleteCalendarEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/modules/inventory/service", () => ({
  validateAndSnapshotItems: vi.fn().mockResolvedValue({ snapshots: [], itemsTotal: 0 }),
  saleBookingItems: vi.fn().mockResolvedValue(undefined),
  returnBookingItems: vi.fn().mockResolvedValue(undefined),
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
    module: {
      findUnique: vi.fn().mockResolvedValue({ config: { maxDiscountPercent: 30 } }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Delegate tx calls to the top-level prisma mocks so existing assertions work
      const { prisma: p } = await import("@/lib/db");
      const tx = {
        booking: p.booking,
        user: { findUnique: vi.fn().mockResolvedValue({ name: "Тест Менеджер", email: "test@test.com" }) },
        resource: { findUnique: vi.fn().mockResolvedValue({ name: "Беседка №1" }) },
        auditLog: { create: vi.fn() },
        inventoryTransaction: { create: vi.fn() },
        inventorySku: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ stockQuantity: 100, isActive: true }) },
      };
      return fn(tx);
    }),
  },
}));

import {
  createBooking,
  createAdminBooking,
  updateBookingStatus,
  cancelBooking,
  getAvailability,
  getTimeline,
  getAnalytics,
  listBookingsPaginated,
} from "@/modules/gazebos/service";
import { prisma } from "@/lib/db";
import { createCalendarEvent } from "@/lib/google-calendar";
import { enqueueNotification } from "@/modules/notifications/queue";

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
          metadata: expect.objectContaining({ guestCount: 4, comment: "День рождения" }),
        }),
      })
    );
  });

  // ===== Guest checkout =====

  it("creates guest booking when userId is null and contacts provided", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(
      mockBooking({ userId: null, clientName: "Иван", clientPhone: "+79001234567" }) as never
    );

    const result = await createBooking(null, {
      ...validBookingInput,
      guestName: "Иван",
      guestPhone: "+79001234567",
    });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          clientName: "Иван",
          clientPhone: "+79001234567",
        }),
      })
    );
    expect(result).toBeDefined();
  });

  it("throws GUEST_CONTACTS_REQUIRED when userId is null and contacts missing", async () => {
    await expect(createBooking(null, validBookingInput)).rejects.toMatchObject({
      code: "GUEST_CONTACTS_REQUIRED",
    });
  });

  it("does not write clientName/Phone when userId is set (authenticated path)", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    // Even if guest fields leak in from the client, authed path ignores them.
    await createBooking("user-1", {
      ...validBookingInput,
      guestName: "Иван",
      guestPhone: "+79001234567",
    });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          clientName: null,
          clientPhone: null,
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
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) })
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
    // COMPLETED goes through $transaction
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
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
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) })
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
  it("returns 15 slots per resource (8:00–23:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]); // no bookings

    const result = await getAvailability(FUTURE_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].slots).toHaveLength(15); // hours 8,9,10,...,22 = 15 slots
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

  it("returns correct slot time labels (first: 08:00, last: 22:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result[0].slots;

    expect(slots[0].startTime).toBe("08:00");
    expect(slots[0].endTime).toBe("09:00");
    expect(slots[slots.length - 1].startTime).toBe("22:00");
    expect(slots[slots.length - 1].endTime).toBe("23:00");
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
  it("should create a confirmed booking with client info as top-level fields", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", clientName: "Иванов Иван", clientPhone: "+7 999 123-45-67" }) as never
    );

    const result = await createAdminBooking("admin-1", validAdminInput);

    expect(result.status).toBe("CONFIRMED");
    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          userId: "admin-1",
          clientName: "Иванов Иван",
          clientPhone: "+7 999 123-45-67",
          metadata: expect.objectContaining({ bookedByAdmin: true }),
        }),
      })
    );
  });

  it("should call Google Calendar when resource has googleCalendarId", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(
      mockResource({ googleCalendarId: "cal-123@group.calendar.google.com" }) as never
    );
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(createCalendarEvent).mockResolvedValue({
      success: true,
      eventId: "gcal-event-1",
    });
    vi.mocked(prisma.booking.create).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", googleEventId: "gcal-event-1" }) as never
    );

    await createAdminBooking("admin-1", validAdminInput);

    expect(createCalendarEvent).toHaveBeenCalledWith(
      "cal-123@group.calendar.google.com",
      expect.objectContaining({
        summary: "Беседка №1 — Иванов Иван",
        description: expect.stringContaining("+7 999 123-45-67"),
      })
    );
    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          googleEventId: "gcal-event-1",
        }),
      })
    );
  });

  it("should not call Google Calendar when resource has no googleCalendarId", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED" }) as never);

    await createAdminBooking("admin-1", validAdminInput);

    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it("should enqueue notification on admin booking creation", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED", id: "new-booking" }) as never);

    await createAdminBooking("admin-1", validAdminInput);

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.confirmed",
        moduleSlug: "gazebos",
        entityId: "new-booking",
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

// === Timeline Tests ===

describe("getTimeline", () => {
  it("should return resources and bookings for given date", async () => {
    const resources = [
      mockResource({ id: "r1", name: "Беседка #1" }),
      mockResource({ id: "r2", name: "Беседка #2" }),
    ];
    const bookings = [
      mockBooking({
        id: "b1",
        resourceId: "r1",
        startTime: new Date(`${FUTURE_DATE}T10:00:00`),
        endTime: new Date(`${FUTURE_DATE}T12:00:00`),
        status: "CONFIRMED",
        clientName: "Иван",
        clientPhone: "+79001234567",
      }),
    ];

    vi.mocked(prisma.resource.findMany).mockResolvedValue(resources as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue(bookings as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.date).toBe(FUTURE_DATE);
    expect(result.resources).toHaveLength(2);
    expect(result.bookings).toHaveLength(1);
    expect(result.hours).toHaveLength(15); // 08:00 to 22:00
    expect(result.hours[0]).toBe("08:00");
    expect(result.hours[14]).toBe("22:00");
    expect(result.bookings[0]).toMatchObject({
      id: "b1",
      resourceId: "r1",
      status: "CONFIRMED",
      clientName: "Иван",
    });
  });

  it("should return empty bookings for a day with no bookings", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.bookings).toHaveLength(0);
    expect(result.resources).toHaveLength(1);
  });

  it("should only include active resources", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    await getTimeline(FUTURE_DATE);

    expect(prisma.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { moduleSlug: "gazebos", isActive: true },
      })
    );
  });

  it("should only include PENDING and CONFIRMED bookings", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    await getTimeline(FUTURE_DATE);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PENDING", "CONFIRMED"] },
        }),
      })
    );
  });
});

// === Analytics Tests ===

describe("getAnalytics", () => {
  it("should return analytics for a period with no bookings", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);

    const result = await getAnalytics("month");

    expect(result.totalBookings).toBe(0);
    expect(result.completedBookings).toBe(0);
    expect(result.cancelledBookings).toBe(0);
    expect(result.totalRevenue).toBe(0);
    expect(result.averageCheck).toBe(0);
    expect(result.byDay).toHaveLength(0);
    expect(result.byResource).toHaveLength(0);
    expect(result.topHours).toHaveLength(0);
  });

  it("should calculate revenue from completed bookings", async () => {
    const bookings = [
      mockBooking({
        id: "b1",
        status: "COMPLETED",
        metadata: { totalPrice: 2000 },
        resource: mockResource(),
      }),
      mockBooking({
        id: "b2",
        status: "COMPLETED",
        metadata: { totalPrice: 3000 },
        resource: mockResource(),
      }),
      mockBooking({
        id: "b3",
        status: "CANCELLED",
        resource: mockResource(),
      }),
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValue(bookings as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);

    const result = await getAnalytics("month");

    expect(result.totalBookings).toBe(3);
    expect(result.completedBookings).toBe(2);
    expect(result.cancelledBookings).toBe(1);
    expect(result.totalRevenue).toBe(5000);
    expect(result.averageCheck).toBe(2500);
  });
});

// === Paginated Bookings Tests ===

describe("listBookingsPaginated", () => {
  it("should return paginated bookings with total count", async () => {
    const bookings = [
      mockBooking({ id: "b1", resource: mockResource(), user: { name: "User1", phone: null, email: null } }),
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValue(bookings as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(25 as never);

    const result = await listBookingsPaginated({ page: 1, perPage: 20 });

    expect(result.bookings).toHaveLength(1);
    expect(result.total).toBe(25);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
  });

  it("should apply status filter", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookingsPaginated({ status: "COMPLETED" });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });

  it("should apply date range filter", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookingsPaginated({ dateFrom: "2026-04-01", dateTo: "2026-04-14" });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: { gte: new Date("2026-04-01"), lte: new Date("2026-04-14") },
        }),
      })
    );
  });
});
