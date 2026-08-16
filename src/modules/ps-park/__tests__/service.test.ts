import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

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

// createAdminBooking дедуплицирует гостя по E.164-телефону перед записью брони.
vi.mock("@/modules/clients/service", () => ({
  upsertClientByPhone: vi.fn().mockResolvedValue({ id: "client-1" }),
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
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    financialTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    module: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    // lockSlot() берёт advisory-блокировку слота первым стейтментом транзакции (#429).
    // Мок $transaction ниже отдаёт сам prisma как tx, поэтому хелпер живёт здесь.
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}));

import {
  createBooking,
  createAdminBooking,
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
  listBookings,
  getBooking,
  getAnalytics,
  listBookingsPaginated,
  softDeleteBooking,
  hardDeleteBooking,
  autoCompleteExpiredSessions,
  getDayReport,
} from "@/modules/ps-park/service";
import { prisma } from "@/lib/db";
import { ACTIVE_BOOKING_STATUSES } from "@/modules/booking/state-machine";
import { validateAndSnapshotItems, saleBookingItems, returnBookingItems } from "@/modules/inventory/service";
import { enqueueNotification } from "@/modules/notifications/queue";

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
  // По умолчанию транзакция прозрачна: колбэк получает сам prisma-мок, поэтому
  // существующие ассерты на prisma.booking.* продолжают работать. Раньше
  // реализация задавалась только в одном describe-блоке, и всё, что переехало
  // в $transaction (#429), в остальных блоках получало undefined.
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prisma) => Promise<unknown>)(prisma)
  );
  // clearAllMocks() чистит .mock.calls, но НЕ снятые через mockResolvedValue
  // реализации — без явного сброса тест, который настроил кастомный
  // Module.config (#434: openHour/closeHour/slotRoundingMinutes/
  // sessionAlertMinutes), протекал бы в следующие тесты файла.
  vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);
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

  // #567: сервер не проверял minBookingHours — только фронт (quick-booking-popover, #523).
  it("throws DURATION_BELOW_MIN when booking is shorter than configured minBookingHours", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { minBookingHours: 2 },
    } as never);

    // validBookingInput — 12:00-13:00, 1h < настроенных 2h.
    await expect(createBooking("user-1", validBookingInput)).rejects.toMatchObject({
      code: "DURATION_BELOW_MIN",
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
    const completedBooking = mockBooking({ status: "COMPLETED" });
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED" }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Менеджер", email: null } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      return (fn as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(completedBooking as never);
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);

    await updateBookingStatus("booking-1", "COMPLETED");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "booking-1",
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
        }),
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
    expect(prisma.financialTransaction.create).toHaveBeenCalled();
  });

  it("throws ALREADY_COMPLETED when concurrent writer already completed (updateMany count=0)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED" }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Менеджер", email: null } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      return (fn as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);

    await expect(updateBookingStatus("booking-1", "COMPLETED")).rejects.toMatchObject({
      code: "ALREADY_COMPLETED",
    });
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  // #511: переход CANCELLED → CONFIRMED теперь существует, но только для
  // SUPERADMIN и только через restoreBooking() с проверкой окна и слота.
  // Обычный PATCH статуса ходит от лица MANAGER и обязан упираться в права,
  // а не в отсутствие перехода.
  it("throws FORBIDDEN for CANCELLED → CONFIRMED (MANAGER)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CANCELLED" }) as never
    );

    await expect(updateBookingStatus("booking-1", "CONFIRMED")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it("throws INVALID_STATUS_TRANSITION when completing already completed (assertValidTransition)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );

    await expect(updateBookingStatus("booking-1", "COMPLETED")).rejects.toMatchObject({
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

// ===== updateBookingStatus PAYMENT_REQUIRED gate (F1 ADR 2026-05-04) =====

describe("updateBookingStatus PAYMENT_REQUIRED gate", () => {
  function setupCheckedInBooking({ pricePerHour = 300 } = {}) {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CHECKED_IN" }) as never
    );
    vi.mocked(prisma.resource.findUnique).mockResolvedValue(
      mockTable({ pricePerHour }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      return (fn as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  }

  // T1 (AC-1): cash=0, card=0, no discount → PAYMENT_REQUIRED
  it("throws PAYMENT_REQUIRED when cash=0, card=0, no discount, totalBill=300", async () => {
    setupCheckedInBooking({ pricePerHour: 300 });

    await expect(
      updateBookingStatus("booking-1", "COMPLETED", "manager-1", undefined, 0, 0)
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      metadata: { shortfall: 300, totalBill: 300, paid: 0 },
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  // T2 (AC-2): partial payment → PAYMENT_REQUIRED with exact shortfall
  it("throws PAYMENT_REQUIRED on partial payment (cash=300, card=0, totalBill=500)", async () => {
    setupCheckedInBooking({ pricePerHour: 500 });

    await expect(
      updateBookingStatus("booking-1", "COMPLETED", "manager-1", undefined, 300, 0)
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      metadata: { shortfall: 200, totalBill: 500, paid: 300 },
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  // T3 (AC-3): cash + card === totalBill → success, FT created
  it("succeeds when cash + card === totalBill (cash=300, card=200, totalBill=500)", async () => {
    setupCheckedInBooking({ pricePerHour: 500 });

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      300,
      200
    );

    expect(prisma.booking.updateMany).toHaveBeenCalled();
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 500,
          cashAmount: 300,
          cardAmount: 200,
        }),
      })
    );
  });

  // T4 (AC-4): 100% discount with reason → cash=0, card=0 OK
  it("succeeds with 100% discount and discountReason='permanent_client', no payment required", async () => {
    setupCheckedInBooking({ pricePerHour: 500 });
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { maxDiscountPercent: 100 },
    } as never);

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      0,
      0,
      { discountPercent: 100, discountReason: "permanent_client" }
    );

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 0,
          cashAmount: 0,
          cardAmount: 0,
        }),
      })
    );
    // session.complete + booking.discount_applied → 2 audit log writes
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });

  // T6 (AC-6): overpayment is allowed (manager hands cash change)
  it("succeeds when cardAmount exceeds totalBill (overpayment, cash=0, card=600, totalBill=500)", async () => {
    setupCheckedInBooking({ pricePerHour: 500 });

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      0,
      600
    );

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cashAmount: 0,
          cardAmount: 600,
        }),
      })
    );
  });

  // T7 (AC-7): totalBill === 0 (no tariff, no items) → no payment required
  it("succeeds when totalBill === 0 (no pricePerHour, no items)", async () => {
    setupCheckedInBooking({ pricePerHour: 0 });

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      0,
      0
    );

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 0,
          cashAmount: 0,
          cardAmount: 0,
        }),
      })
    );
  });

  // T9 (CRON regression): auto-complete bypasses PAYMENT_REQUIRED gate
  it("CRON auto-complete bypasses PAYMENT_REQUIRED gate even when cash=undefined and totalBill>0", async () => {
    setupCheckedInBooking({ pricePerHour: 300 });

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      undefined,
      undefined,
      undefined,
      "CRON"
    );

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 300,
          cashAmount: 300,
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "session.auto_complete",
          metadata: expect.objectContaining({ actor: "CRON" }),
        }),
      })
    );
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

  it("creates ADJUSTMENT FT and post-factum audit log when booking is COMPLETED", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "COMPLETED",
        metadata: {
          items: [],
          itemsTotal: "0.00",
          bill: { completedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        },
      }) as never
    );
    vi.mocked(validateAndSnapshotItems).mockResolvedValue({
      snapshots: [snapshot],
      itemsTotal: 250,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Менеджер", email: null } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
      (fn as (tx: typeof prisma) => Promise<unknown>)(prisma)
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "COMPLETED" }) as never);
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);

    await addItemsToBooking("booking-1", "manager-1", newItems);

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ADJUSTMENT",
          bookingId: "booking-1",
          totalAmount: 250,
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "session.items_added_post_complete",
        }),
      })
    );
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

  // #523: quick-booking-popover.tsx hardcoded MIN_BOOKING_HOURS=4 instead of
  // reading it from Module.config (which ps-park never even had a reader
  // for) — getTimeline() now carries the real settings value.
  it("returns minBookingHours from Module.config", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { minBookingHours: 2 },
    } as never);

    const result = await getTimeline(FUTURE_DATE);
    expect(result.minBookingHours).toBe(2);
  });

  it("falls back to the default (1h) when Module.config has no minBookingHours", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);

    const result = await getTimeline(FUTURE_DATE);
    expect(result.minBookingHours).toBe(1);
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

  // #434: openHour/closeHour были захардкожены — форма настроек значения
  // валидировала и сохраняла, но сервис их не читал.
  it("столбцы hours строятся по Module.config, а не по хардкоду 8–23", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { openHour: 9, closeHour: 20 },
    } as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.hours).toHaveLength(11); // 9,10,...,19
    expect(result.hours[0]).toBe("09:00");
    expect(result.hours[result.hours.length - 1]).toBe("19:00");
  });

  // #614: resources переносились в TimelineGrid/MobileTimeline (Client
  // Components) с сырым Prisma Decimal в pricePerHour — не сериализуется
  // через границу Server → Client, React ругался в консоли на каждой
  // загрузке. pricePerHour теперь всегда plain number/null.
  it("converts resource pricePerHour to a plain number, not a Decimal-like object", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      mockTable({ pricePerHour: new Prisma.Decimal(300.5) }),
    ] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.resources[0].pricePerHour).toBe(300.5);
    expect(typeof result.resources[0].pricePerHour).toBe("number");
  });

  it("keeps resource pricePerHour null when the resource has none", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      mockTable({ pricePerHour: null }),
    ] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.resources[0].pricePerHour).toBeNull();
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
    // Freeze time to avoid flakiness: the service calls `new Date()` internally,
    // so any wall-clock drift past the 30-minute boundary would bump billedHours
    // from 0.5 to the next 15-minute slot.
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(now);
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

    // Session has been running for 30 min → live bill reflects elapsed time, not scheduled full hour.
    expect(result).toHaveLength(1);
    expect(result[0].pricePerHour).toBe(500);
    expect(result[0].billedHours).toBe(0.5);
    expect(result[0].hoursCost).toBe(250);
    expect(result[0].itemsTotal).toBe(300);
    expect(result[0].totalBill).toBe(550);
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].subtotal).toBe(300);

    vi.useRealTimers();
  });

  // #434: slotRoundingMinutes/sessionAlertMinutes были захардкожены (15 мин
  // округление счёта, 10 мин порог алерта) — форма настроек их сохраняла,
  // но сервис не читал. 40 мин длительности: с шагом 15 → 3×15=45мин=0.75ч,
  // с шагом 30 → 2×30=60мин=1.0ч — разные значения показывают, что читается
  // именно настроенный slotRoundingMinutes, а не хардкод.
  it("округляет счёт по настроенному slotRoundingMinutes, а не по хардкоду 15", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(now);
    const booking = {
      id: "b-active",
      resourceId: "table-1",
      status: "CONFIRMED",
      date: new Date(now.toISOString().split("T")[0]),
      startTime: new Date(now.getTime() - 40 * 60 * 1000), // 40 min ago
      endTime: new Date(now.getTime() + 60 * 60 * 1000),
      clientName: "Иван",
      clientPhone: "+79001234567",
      userId: "user-1",
      metadata: {},
    };
    vi.mocked(prisma.booking.findMany).mockResolvedValue([booking] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      mockTable({ pricePerHour: 600 }),
    ] as never);

    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);
    const withDefault = await getActiveSessions();
    expect(withDefault[0].billedHours).toBe(0.75); // дефолт 15 мин: ceil(40/15)=3 → 0.75ч

    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { slotRoundingMinutes: 30 },
    } as never);
    const withConfigured = await getActiveSessions();
    expect(withConfigured[0].billedHours).toBe(1); // настроено 30 мин: ceil(40/30)=2 → 1.0ч

    vi.useRealTimers();
  });

  it("выставляет alertMinutes из настроек модуля в каждую активную сессию", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      {
        id: "b-active",
        resourceId: "table-1",
        status: "CONFIRMED",
        date: new Date(),
        startTime: new Date(Date.now() - 10 * 60 * 1000),
        endTime: new Date(Date.now() + 10 * 60 * 1000),
        clientName: "Иван",
        clientPhone: "+79001234567",
        userId: "user-1",
        metadata: {},
      },
    ] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { sessionAlertMinutes: 15 },
    } as never);

    const result = await getActiveSessions();

    expect(result[0].alertMinutes).toBe(15);
  });

  it("падает обратно на sessionAlertMinutes=10, если не настроено", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      {
        id: "b-active",
        resourceId: "table-1",
        status: "CONFIRMED",
        date: new Date(),
        startTime: new Date(Date.now() - 10 * 60 * 1000),
        endTime: new Date(Date.now() + 10 * 60 * 1000),
        clientName: "Иван",
        clientPhone: "+79001234567",
        userId: "user-1",
        metadata: {},
      },
    ] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);

    const result = await getActiveSessions();

    expect(result[0].alertMinutes).toBe(10);
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
        endTime: new Date(`${FUTURE_DATE}T23:00:00+03:00`),
      }) as never
    );

    await expect(extendBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BEYOND_CLOSING",
    });
  });

  // #434: closeHour было захардкожено 23 — форма настроек значение сохраняла,
  // но проверка «не выходит за рабочие часы» его не читала.
  it("уважает настроенный closeHour, а не хардкод 23:00", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        endTime: new Date(`${FUTURE_DATE}T20:00:00+03:00`),
      }) as never
    );
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { closeHour: 20 },
    } as never);

    // Продление на 1ч довело бы до 21:00, но настроено closeHour=20.
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

    expect(bill.billedHours).toBe(2);
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
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({
          status: "NO_SHOW",
          startTime: new Date(Date.now() - 60 * 60 * 1000),
          metadata: { noShowAt: new Date().toISOString(), noShowReason: "auto" },
        }) as never
      ) // саму бронь нашли
      .mockResolvedValueOnce(null); // слот свободен под блокировкой (#478)
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

// ===== #478: NO_SHOW → CHECKED_IN не проверял занятость слота =====
//
// Слот честно освобождается, когда бронь уходит в NO_SHOW (#424, #429), и мог
// быть отдан другому гостю. До фикса реактивация неявки была голым update без
// конфликт-чека и блокировки — опоздавший гость создавал двойную бронь.
describe("NO_SHOW → CHECKED_IN конфликт-чек (#478)", () => {
  it("отдаёт BOOKING_CONFLICT и не меняет статус, если слот уже занят другой бронью", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({ status: "NO_SHOW", startTime: new Date(Date.now() - 60 * 60 * 1000) }) as never
      ) // саму бронь нашли
      .mockResolvedValueOnce(mockBooking({ id: "booking-2", status: "CONFIRMED" }) as never); // конфликт под блокировкой

    await expect(checkInBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_CONFLICT",
    });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it("делает конфликт-чек под advisory-блокировкой слота (та же транзакция, что при создании брони)", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({ status: "NO_SHOW", startTime: new Date(Date.now() - 60 * 60 * 1000) }) as never
      )
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "CHECKED_IN" }) as never);

    await checkInBooking("booking-1", "manager-1");

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("CONFIRMED → CHECKED_IN не берёт лишней блокировки слота (уже занимал его)", async () => {
    const pastStart = new Date(Date.now() - 10 * 60 * 1000);
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(
      mockBooking({ status: "CONFIRMED", startTime: pastStart }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "CHECKED_IN" }) as never);

    await checkInBooking("booking-1", "manager-1");

    expect(prisma.$transaction).not.toHaveBeenCalled();
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

  // #440: порог неявки был захардкожен `30` — markNoShow всегда проверял
  // ровно 30 минут после startTime, настройка Module.config.noShowThresholdMinutes
  // ни на что не влияла.
  it("уважает настроенный noShowThresholdMinutes из Module.config", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { noShowThresholdMinutes: 10 },
    } as never);
    const startedAgo = new Date(Date.now() - 15 * 60 * 1000); // 15 минут назад
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED", startTime: startedAgo }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "NO_SHOW" }) as never);

    // 15 минут прошло, порог настроен на 10 — переход должен пройти
    // (дефолтные 30 минут этот переход бы отклонили — см. тест выше).
    await expect(markNoShow("booking-1", "manager-1", "manual")).resolves.toBeDefined();
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
        startTime: new Date(`${FUTURE_DATE}T12:00:00+03:00`),
        endTime: new Date(`${FUTURE_DATE}T13:00:00+03:00`),
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

  // #434: openHour/closeHour были захардкожены — форма настроек значения
  // валидировала и сохраняла, но сервис их не читал.
  it("генерирует слоты по openHour/closeHour из Module.config, а не по хардкоду 8–23", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { openHour: 10, closeHour: 18 },
    } as never);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result[0].slots;

    expect(slots).toHaveLength(8); // 10,11,...,17
    expect(slots[0].startTime).toBe("10:00");
    expect(slots[slots.length - 1].endTime).toBe("18:00");
  });
});

// ===== Soft-delete: deletedAt: null filter in read functions =====

describe("soft-delete filter (deletedAt: null) in read functions", () => {
  it("listBookings adds deletedAt: null to where clause", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0);

    await listBookings();

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, moduleSlug: "ps-park" }),
      })
    );
    expect(prisma.booking.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("getBooking filters by deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    await getBooking("some-id");
    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  // #512: checkInBooking looked up the booking without deletedAt: null,
  // unlike its gazebos counterpart — a soft-deleted booking could still be
  // checked in even though the admin UI no longer shows it as active.
  it("checkInBooking filters by deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(checkInBooking("some-id", "manager-1")).rejects.toThrow("Бронирование не найдено");

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("getTimeline filters soft-deleted bookings", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    await getTimeline(FUTURE_DATE);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("getAvailability does not block slot by soft-deleted booking", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    // prisma would not return deletedAt: null-filtered rows in real life — we
    // assert the where clause carries the filter.
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    const result = await getAvailability(FUTURE_DATE);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
    // With no (non-deleted) bookings, every slot is free.
    expect(result[0].slots.every((s) => s.isAvailable)).toBe(true);
  });

  it("getActiveSessions filters soft-deleted", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    await getActiveSessions();
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("getAnalytics filters soft-deleted bookings and their transactions", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany)
      // 1st call: non-deleted bookings
      .mockResolvedValueOnce([mockBooking({ status: "COMPLETED" })] as never)
      // 2nd call: inside the "deletedBookingIds" lookup
      .mockResolvedValueOnce([{ id: "deleted-1" }] as never);
    vi.mocked(prisma.financialTransaction.findMany).mockResolvedValue([
      { id: "tx-1", bookingId: "alive", totalAmount: 500, createdAt: new Date() },
      { id: "tx-2", bookingId: "deleted-1", totalAmount: 1000, createdAt: new Date() },
    ] as never);

    const result = await getAnalytics("week");

    // Only the transaction for the alive booking contributes to revenue.
    expect(result.totalRevenue).toBe(500);
    // First call: bookings findMany with deletedAt: null.
    expect(prisma.booking.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("listBookingsPaginated filters soft-deleted", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    await listBookingsPaginated({});
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  // #438: «гость звонит: я бронировал» — найти бронь по имени/телефону.
  it("listBookingsPaginated applies search filter across clientName and clientPhone (case-insensitive)", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listBookingsPaginated({ search: "Петров" });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { clientName: { contains: "Петров", mode: "insensitive" } },
            { clientPhone: { contains: "Петров", mode: "insensitive" } },
          ],
        }),
      })
    );
  });

  it("listBookingsPaginated does not add OR clause when search is empty", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listBookingsPaginated({});

    const call = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    expect(call?.where).not.toHaveProperty("OR");
  });

  // #509: psBookingFilterSchema validates userId, but listBookingsPaginated
  // silently dropped it instead of filtering — this pins the fix.
  it("listBookingsPaginated applies userId filter", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listBookingsPaginated({ userId: "user-42" });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-42" }),
      })
    );
  });

  it("listBookingsPaginated does not add userId to where when not provided", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listBookingsPaginated({});

    const call = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    expect(call?.where).not.toHaveProperty("userId");
  });

  it("createBooking conflict-check ignores soft-deleted rows", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });
});

// ===== softDeleteBooking / hardDeleteBooking =====

describe("softDeleteBooking", () => {
  it("sets deletedAt on a PENDING booking (no inventory return)", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "PENDING", deletedAt: null }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(
      mockBooking({ deletedAt: new Date() }) as never
    );

    await softDeleteBooking("booking-1", "admin-1");

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1" },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(returnBookingItems).not.toHaveBeenCalled();
  });

  it("returns inventory when soft-deleting a CONFIRMED booking with items", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        deletedAt: null,
        metadata: {
          items: [{ skuId: "sku-1", skuName: "Cola", quantity: 1, priceAtBooking: 150 }],
        },
      }) as never
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = { booking: { update: vi.fn().mockResolvedValue({ id: "booking-1" }) } };
      return fn(tx);
    });

    await softDeleteBooking("booking-1", "admin-1");

    expect(returnBookingItems).toHaveBeenCalled();
  });

  it("throws BOOKING_ALREADY_DELETED if already soft-deleted", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CANCELLED", deletedAt: new Date() }) as never
    );
    await expect(softDeleteBooking("booking-1", "admin-1")).rejects.toMatchObject({
      code: "BOOKING_ALREADY_DELETED",
    });
  });

  it("throws BOOKING_NOT_FOUND when not found", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    await expect(softDeleteBooking("missing", "admin-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });
  });
});

describe("hardDeleteBooking", () => {
  it("physically removes the booking via tx.booking.delete", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "PENDING", deletedAt: null, metadata: {} }) as never
    );
    const txDelete = vi.fn().mockResolvedValue({ id: "booking-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = { booking: { delete: txDelete } };
      return fn(tx);
    });

    await hardDeleteBooking("booking-1", "super-1");

    expect(txDelete).toHaveBeenCalledWith({ where: { id: "booking-1" } });
  });

  it("returns inventory before delete for CONFIRMED booking with items", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        deletedAt: null,
        metadata: {
          items: [{ skuId: "sku-1", skuName: "Cola", quantity: 1, priceAtBooking: 150 }],
        },
      }) as never
    );
    const txDelete = vi.fn().mockResolvedValue({ id: "booking-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = { booking: { delete: txDelete } };
      return fn(tx);
    });

    await hardDeleteBooking("booking-1", "super-1");

    expect(returnBookingItems).toHaveBeenCalled();
    expect(txDelete).toHaveBeenCalled();
  });

  it("skips item-return when booking was already soft-deleted", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        deletedAt: new Date(),
        metadata: {
          items: [{ skuId: "sku-1", skuName: "Cola", quantity: 1, priceAtBooking: 150 }],
        },
      }) as never
    );
    const txDelete = vi.fn().mockResolvedValue({ id: "booking-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = { booking: { delete: txDelete } };
      return fn(tx);
    });

    await hardDeleteBooking("booking-1", "super-1");

    expect(returnBookingItems).not.toHaveBeenCalled();
    expect(txDelete).toHaveBeenCalled();
  });
});

// ===== getDayReport =====

describe("getDayReport", () => {
  it("uses MSK day window and includes ADJUSTMENT transactions in revenue", async () => {
    vi.mocked(prisma.financialTransaction.findMany).mockResolvedValue([
      {
        id: "tx-1",
        bookingId: "b-1",
        totalAmount: 600,
        cashAmount: 600,
        cardAmount: 0,
        performedByName: "Менеджер",
        description: "Сессия",
        createdAt: new Date("2026-04-27T20:00:00+03:00"),
      },
      {
        id: "tx-2",
        bookingId: "b-2",
        totalAmount: 250,
        cashAmount: 0,
        cardAmount: 250,
        performedByName: "Менеджер",
        description: "Доплата",
        createdAt: new Date("2026-04-27T22:30:00+03:00"),
      },
    ] as never);

    const report = await getDayReport("2026-04-27");

    const callArg = vi.mocked(prisma.financialTransaction.findMany).mock.calls[0][0]!;
    const where = callArg.where as { type?: { in: string[] }; createdAt?: { gte: Date; lte: Date } };
    expect(where.type).toEqual({ in: ["SESSION_PAYMENT", "ADJUSTMENT"] });
    // 00:00 MSK on 2026-04-27 is 21:00 UTC on 2026-04-26.
    expect(where.createdAt!.gte.toISOString()).toBe("2026-04-26T21:00:00.000Z");
    expect(where.createdAt!.lte.toISOString()).toBe("2026-04-27T20:59:59.999Z");

    expect(report.cashTotal).toBe(600);
    expect(report.cardTotal).toBe(250);
    expect(report.totalRevenue).toBe(850);
    expect(report.totalSessions).toBe(2);
  });
});

// ===== autoCompleteExpiredSessions =====

describe("autoCompleteExpiredSessions", () => {
  it("processes expired CONFIRMED/CHECKED_IN sessions and counts skipped on ALREADY_COMPLETED", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      { id: "b-1" },
      { id: "b-2" },
      { id: "b-3" },
    ] as never);

    const completedRow = mockBooking({ status: "COMPLETED" });
    vi.mocked(prisma.booking.findFirst)
      // b-1 → CONFIRMED, succeeds
      .mockResolvedValueOnce(mockBooking({ status: "CONFIRMED" }) as never)
      // b-2 → CONFIRMED, but updateMany returns count=0 (race) → ALREADY_COMPLETED
      .mockResolvedValueOnce(mockBooking({ status: "CONFIRMED" }) as never)
      // b-3 → already COMPLETED, state-machine throws INVALID_STATUS_TRANSITION
      .mockResolvedValueOnce(mockBooking({ status: "COMPLETED" }) as never);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Admin", email: null } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
      (fn as (tx: typeof prisma) => Promise<unknown>)(prisma)
    );
    // First call → count=1 (success), second → count=0 (race)
    vi.mocked(prisma.booking.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(completedRow as never);
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);

    const result = await autoCompleteExpiredSessions("admin-1");

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([]);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
          deletedAt: null,
        }),
      })
    );

    // AC-4.3: cron path writes session.auto_complete (not session.complete)
    // with metadata.actor = "CRON".
    const auditCalls = vi.mocked(prisma.auditLog.create).mock.calls;
    const autoCompleteAudit = auditCalls.find(
      (c) => (c[0] as unknown as { data: { action: string } }).data.action === "session.auto_complete"
    );
    expect(autoCompleteAudit).toBeDefined();
    const meta = (autoCompleteAudit![0] as unknown as { data: { metadata: { actor: string } } }).data.metadata;
    expect(meta.actor).toBe("CRON");
  });
});

// ===== F7: subscription debit + drilldown =====

vi.mock("@/modules/subscriptions/service", async () => {
  const actual = await vi.importActual<object>("@/modules/subscriptions/service");
  return {
    ...actual,
    getActiveSubscriptionForUser: vi.fn(),
  };
});

vi.mock("@/modules/subscriptions/debit", async () => {
  const actual = await vi.importActual<object>("@/modules/subscriptions/debit");
  return {
    ...actual,
    debitFromSession: vi.fn(),
  };
});

import { getActiveSubscriptionForUser } from "@/modules/subscriptions/service";
import { debitFromSession, SubscriptionDebitError } from "@/modules/subscriptions/debit";

describe("updateBookingStatus subscription path (F7)", () => {
  function setupCheckedInBookingForSub({
    pricePerHour = 300,
    userId = "guest-1",
  }: { pricePerHour?: number; userId?: string | null } = {}) {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CHECKED_IN", userId }) as never
    );
    vi.mocked(prisma.resource.findUnique).mockResolvedValue(
      mockTable({ pricePerHour }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      return (fn as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  }

  // P1
  it("happy path with valid subscriptionId — FT(0), debit called, AuditLog has paymentMethod=SUBSCRIPTION", async () => {
    setupCheckedInBookingForSub();
    vi.mocked(getActiveSubscriptionForUser).mockResolvedValue({
      id: "sub-1",
      remainingHours: { toString: () => "5" } as never,
    } as never);
    vi.mocked(debitFromSession).mockResolvedValue({
      hoursDebited: 1,
      remainingAfter: 4,
      becameDepleted: false,
    });

    await updateBookingStatus(
      "booking-1", "COMPLETED", "manager-1",
      undefined, undefined, undefined, undefined, "MANAGER", "sub-1"
    );

    expect(debitFromSession).toHaveBeenCalled();
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 0,
          cashAmount: 0,
          cardAmount: 0,
          metadata: expect.objectContaining({ paymentMethod: "SUBSCRIPTION" }),
        }),
      })
    );
  });

  // P2
  it("INVALID_PAYMENT_COMBINATION when subscriptionId + discountInput", async () => {
    setupCheckedInBookingForSub();

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, 0, 0,
        { discountPercent: 10, discountReason: "promo" },
        "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_COMBINATION",
      metadata: { hasDiscount: true },
    });
  });

  // P3 + P4
  it("INVALID_PAYMENT_COMBINATION when subscriptionId + cash > 0", async () => {
    setupCheckedInBookingForSub();

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, 100, 0, undefined, "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_COMBINATION",
      metadata: { hasCash: true },
    });
  });

  it("INVALID_PAYMENT_COMBINATION when subscriptionId + card > 0", async () => {
    setupCheckedInBookingForSub();

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, 0, 100, undefined, "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_COMBINATION",
      metadata: { hasCard: true },
    });
  });

  // P5
  it("INVALID_SUBSCRIPTION for guest booking (userId=null)", async () => {
    setupCheckedInBookingForSub({ userId: null });

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, undefined, undefined, undefined, "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INVALID_SUBSCRIPTION",
    });
  });

  // P6
  it("INVALID_SUBSCRIPTION when payload subscriptionId differs from active", async () => {
    setupCheckedInBookingForSub();
    vi.mocked(getActiveSubscriptionForUser).mockResolvedValue({
      id: "sub-active",
      remainingHours: { toString: () => "5" } as never,
    } as never);

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, undefined, undefined, undefined, "MANAGER", "sub-stale"
      )
    ).rejects.toMatchObject({
      code: "INVALID_SUBSCRIPTION",
      metadata: { providedId: "sub-stale", currentActiveId: "sub-active" },
    });
  });

  // P7
  it("INVALID_SUBSCRIPTION when no active sub (lazy-expired in helper)", async () => {
    setupCheckedInBookingForSub();
    vi.mocked(getActiveSubscriptionForUser).mockResolvedValue(null);

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, undefined, undefined, undefined, "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INVALID_SUBSCRIPTION",
      metadata: { currentActiveId: null },
    });
  });

  // P8
  it("INSUFFICIENT_HOURS pre-check (defensive)", async () => {
    setupCheckedInBookingForSub({ pricePerHour: 300 });
    vi.mocked(getActiveSubscriptionForUser).mockResolvedValue({
      id: "sub-1",
      remainingHours: { toString: () => "0.5" } as never,
    } as never);

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, undefined, undefined, undefined, "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_HOURS",
      metadata: { subscriptionId: "sub-1" },
    });
  });

  // P9
  it("INSUFFICIENT_HOURS when debit race lost inside tx", async () => {
    setupCheckedInBookingForSub();
    vi.mocked(getActiveSubscriptionForUser).mockResolvedValue({
      id: "sub-1",
      remainingHours: { toString: () => "5" } as never,
    } as never);
    vi.mocked(debitFromSession).mockRejectedValue(
      new SubscriptionDebitError("INSUFFICIENT_HOURS", "race lost", {
        requested: 1,
        remainingHours: "0",
        currentStatus: "ACTIVE",
      })
    );

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, undefined, undefined, undefined, "MANAGER", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_HOURS",
      metadata: { requested: 1 },
    });
  });

  // P12
  it("INVALID_PAYMENT_COMBINATION when actorRole=CRON + subscriptionId", async () => {
    setupCheckedInBookingForSub();

    await expect(
      updateBookingStatus(
        "booking-1", "COMPLETED", "manager-1",
        undefined, undefined, undefined, undefined, "CRON", "sub-1"
      )
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_COMBINATION",
      metadata: { actorRole: "CRON" },
    });
  });
});

// ===== #429: конфликт-чек и запись под блокировкой слота =====
//
// Падали бы до фикса: чек шёл через prisma вне транзакции, поэтому ни
// $transaction, ни advisory-блокировки в этих путях не было вовсе.
describe("сериализация слота (#429)", () => {
  it("createBooking делает чек и запись в одной транзакции под блокировкой", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("createBooking не пишет бронь, если конфликт нашёлся уже под блокировкой", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    // Гонка: снаружи было свободно, но к моменту блокировки стол занят.
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(mockBooking() as never);

    await expect(createBooking("user-1", validBookingInput)).rejects.toThrow("уже занято");
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("extendBooking блокирует слот перед проверкой следующего часа", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce({ ...mockBooking(), status: "CONFIRMED" } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking() as never);

    await extendBooking("booking-1", "manager-1");

    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});

// ===== createAdminBooking =====
//
// Функция не была покрыта ни одним тестом вообще — её даже не импортировали в
// этот файл. Обнаружено код-ревью #429: авторитетный чек под блокировкой слота
// числился «закрытым местом», но ни разу не исполнялся в тестах.
describe("createAdminBooking", () => {
  const validAdminInput = {
    resourceId: "table-1",
    date: FUTURE_DATE,
    startTime: "12:00",
    endTime: "13:00",
    clientName: "Иван Петров",
    clientPhone: "+79991234567",
  };

  it("создаёт подтверждённую бронь с привязкой к клиенту и менеджеру", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createAdminBooking("admin-1", validAdminInput);

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          managerId: "admin-1",
          userId: "client-1",
          clientName: "Иван Петров",
        }),
      })
    );
  });

  it("отказывает на очевидном конфликте, не доходя до транзакции", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(mockBooking() as never);

    await expect(createAdminBooking("admin-1", validAdminInput)).rejects.toThrow("уже занято");
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  // Гонка: внешний pre-check увидел «свободно», а пока создавался клиент и
  // событие календаря, слот заняли. Ловит авторитетный чек под блокировкой (#429).
  it("отказывает, если конфликт нашёлся только под блокировкой слота", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockBooking() as never);

    await expect(createAdminBooking("admin-1", validAdminInput)).rejects.toThrow("уже занято");

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("отказывает, если стол не найден", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(null);

    await expect(createAdminBooking("admin-1", validAdminInput)).rejects.toThrow(
      "Стол не найден"
    );
  });

  // #567: createAdminBooking (POST /api/ps-park/admin-book) не проверял
  // minBookingHours на сервере — попап после #523 не даёт создать короткую
  // бронь, но прямой вызов эндпоинта (curl/Postman) обходил ограничение.
  it("отказывает, если админ-бронь короче настроенного minBookingHours", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { minBookingHours: 2 },
    } as never);

    // validAdminInput — 12:00-13:00, 1h < настроенных 2h.
    await expect(createAdminBooking("admin-1", validAdminInput)).rejects.toMatchObject({
      code: "DURATION_BELOW_MIN",
    });
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  // #437: booking.confirmed не постится в канал смены (шаблон убран для
  // публичных PENDING→CONFIRMED) — брони по телефону нужен отдельный
  // канал-only тип события с данными клиента для шаблона.
  it("шлёт отдельное событие booking.admin_created для канала смены", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(
      mockBooking({ id: "new-booking", status: "CONFIRMED" }) as never
    );

    await createAdminBooking("admin-1", validAdminInput);

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.admin_created",
        moduleSlug: "ps-park",
        entityId: "new-booking",
        userId: "client-1",
        data: expect.objectContaining({
          clientName: "Иван Петров",
          clientPhone: "+79991234567",
          bookingId: "new-booking",
        }),
      })
    );
  });
});

// ===== #424: CHECKED_IN занимает слот =====
describe("CHECKED_IN занимает слот (#424)", () => {
  it("createBooking отказывает, если стол занят заехавшим гостем", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    // Мок эмулирует фильтрацию Prisma: заехавший гость «найдётся» только если
    // запрос действительно спросил CHECKED_IN. С безусловным mockResolvedValue
    // тест проходил бы и на старом коде.
    vi.mocked(prisma.booking.findFirst).mockImplementation((async (args: {
      where?: { status?: { in?: string[] } };
    }) => {
      const asked = args?.where?.status?.in ?? [];
      return asked.includes("CHECKED_IN") ? mockBooking({ status: "CHECKED_IN" }) : null;
    }) as never);

    await expect(createBooking("user-1", validBookingInput)).rejects.toThrow("уже занято");
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("конфликт-чек createBooking спрашивает у БД все занимающие статусы", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockTable() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ACTIVE_BOOKING_STATUSES } }),
      })
    );
  });

  it("getTimeline показывает заехавшего гостя, иначе сетка врёт менеджеру", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockTable()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    await getTimeline(FUTURE_DATE);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ACTIVE_BOOKING_STATUSES } }),
      })
    );
  });
});
