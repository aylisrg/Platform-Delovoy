import { describe, it, expect, vi, beforeEach } from "vitest";

// Общий мок advisory-блокировки слота: hoisted, чтобы на него можно было
// ассертить из тестов (#429) — иначе он пересоздавался бы на каждую транзакцию.
const { txExecuteRaw } = vi.hoisted(() => ({
  txExecuteRaw: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/lib/google-calendar", () => ({
  createCalendarEvent: vi.fn().mockResolvedValue({ success: false }),
  deleteCalendarEvent: vi.fn().mockResolvedValue({ success: true }),
  updateCalendarEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/modules/inventory/service", () => ({
  validateAndSnapshotItems: vi.fn().mockResolvedValue({ snapshots: [], itemsTotal: 0 }),
  saleBookingItems: vi.fn().mockResolvedValue(undefined),
  returnBookingItems: vi.fn().mockResolvedValue(undefined),
}));

// Онлайн-оплата (YooKassa) в этих тестах не задействована: env-ключей нет,
// поэтому createBooking платёж не создаёт; автовозвраты мокируются как no-op.
vi.mock("@/modules/payments/service", () => ({
  createOnlinePayment: vi.fn(),
  autoRefundOnCancellation: vi.fn().mockResolvedValue({ refunded: false, reason: "no_payment" }),
}));

// createAdminBooking дедуплицирует гостя по E.164-телефону перед записью брони (#430).
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
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    financialTransaction: {
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    module: {
      findUnique: vi.fn().mockResolvedValue({ config: { maxDiscountPercent: 30, minBookingHours: 4 } }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Delegate tx calls to the top-level prisma mocks so existing assertions work
      const { prisma: p } = await import("@/lib/db");
      const tx = {
        booking: p.booking,
        user: p.user,
        resource: { findUnique: vi.fn().mockResolvedValue({ name: "Беседка №1" }) },
        auditLog: p.auditLog,
        financialTransaction: p.financialTransaction,
        inventoryTransaction: { create: vi.fn() },
        inventorySku: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ stockQuantity: 100, isActive: true }) },
        // lockSlot() берёт advisory-блокировку слота первым стейтментом транзакции (#429)
        $executeRaw: txExecuteRaw,
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
  rescheduleBooking,
  checkInBooking,
  markNoShow,
  listBookings,
  getBooking,
  getAvailability,
  getTimeline,
  getAnalytics,
  listBookingsPaginated,
} from "@/modules/gazebos/service";
import { prisma } from "@/lib/db";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar";
import { enqueueNotification } from "@/modules/notifications/queue";
import { ACTIVE_BOOKING_STATUSES } from "@/modules/booking/state-machine";
import { upsertClientByPhone } from "@/modules/clients/service";

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
  endTime: "14:00", // 4 hours — meets minimum
};

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks() чистит .mock.calls, но НЕ снятые через mockResolvedValue
  // реализации — без явного сброса тест, который настроил кастомный
  // Module.config (#434: openHour/closeHour/maxBookingHours), протекал бы в
  // следующие тесты файла, даже не относящиеся к нему.
  vi.mocked(prisma.module.findUnique).mockResolvedValue({
    config: { maxDiscountPercent: 30, minBookingHours: 4 },
  } as never);
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

  it("stores startTime/endTime as Moscow-local instants (TZ regression)", async () => {
    // Regression for the gazebos timezone bug: a booking for 10:00–14:00 Moscow
    // must be persisted as 07:00Z–11:00Z, independent of the server timezone.
    // Before the fix `new Date("2030-06-15T10:00:00")` on a UTC server stored
    // 10:00Z, so the admin timeline (rendered in Moscow TZ) showed it 3h late.
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startTime: new Date("2030-06-15T07:00:00.000Z"),
          endTime: new Date("2030-06-15T11:00:00.000Z"),
        }),
      })
    );
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

  it("throws DURATION_BELOW_MIN when booking is shorter than minBookingHours", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(
      createBooking("user-1", { ...validBookingInput, startTime: "10:00", endTime: "13:00" }) // 3h < 4h
    ).rejects.toMatchObject({ code: "DURATION_BELOW_MIN" });
  });

  it("accepts booking exactly at minBookingHours (4h)", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await expect(
      createBooking("user-1", { ...validBookingInput, startTime: "10:00", endTime: "14:00" })
    ).resolves.toBeDefined();
  });

  // #434: maxBookingHours было в форме настроек, но нигде не читалось —
  // бронь любой длины внутри часов работы проходила.
  it("throws DURATION_ABOVE_MAX when booking exceeds maxBookingHours (default 8h)", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(
      createBooking("user-1", { ...validBookingInput, startTime: "08:00", endTime: "18:00" }) // 10h > 8h
    ).rejects.toMatchObject({ code: "DURATION_ABOVE_MAX" });
  });

  it("уважает настроенный maxBookingHours из Module.config", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { minBookingHours: 4, maxBookingHours: 5 },
    } as never);

    await expect(
      createBooking("user-1", { ...validBookingInput, startTime: "10:00", endTime: "16:00" }) // 6h > 5h
    ).rejects.toMatchObject({ code: "DURATION_ABOVE_MAX" });
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

  it("transitions CONFIRMED → COMPLETED with zero totalBill (no metadata.totalPrice)", async () => {
    // No metadata.totalPrice → totalBill === 0 → payment gate passes without cash/card.
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({ status: "CONFIRMED" }) as never
    );
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);

    await updateBookingStatus("booking-1", "COMPLETED", "manager-1");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "booking-1",
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
        }),
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          moduleSlug: "gazebos",
          totalAmount: 0,
        }),
      })
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

// ===== updateBookingStatus PAYMENT_REQUIRED gate (F3 ADR 2026-05-04) =====

describe("updateBookingStatus PAYMENT_REQUIRED gate", () => {
  function setupPayableBooking({ totalPrice = "1500.00" } = {}) {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(
      mockBooking({
        status: "CONFIRMED",
        metadata: { totalPrice },
      }) as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Менеджер",
      email: null,
    } as never);
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValue(
      mockBooking({ status: "COMPLETED" }) as never
    );
    vi.mocked(prisma.financialTransaction.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  }

  // T1 (AC-1): cash=0, card=0, totalBill=1500 → PAYMENT_REQUIRED
  it("throws PAYMENT_REQUIRED when cash=0, card=0, totalBill=1500", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });

    await expect(
      updateBookingStatus("booking-1", "COMPLETED", "manager-1", undefined, 0, 0)
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      metadata: { shortfall: 1500, totalBill: 1500, paid: 0 },
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  // T2 (AC-2): partial → PAYMENT_REQUIRED with shortfall
  it("throws PAYMENT_REQUIRED on partial payment (cash=1000, card=0, totalBill=1500)", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });

    await expect(
      updateBookingStatus("booking-1", "COMPLETED", "manager-1", undefined, 1000, 0)
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      metadata: { shortfall: 500, totalBill: 1500, paid: 1000 },
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  // T3 (AC-3): cash + card === totalBill → success, FT created
  it("succeeds when cash + card === totalBill (cash=1000, card=500, totalBill=1500)", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      1000,
      500
    );

    expect(prisma.booking.updateMany).toHaveBeenCalled();
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          moduleSlug: "gazebos",
          type: "SESSION_PAYMENT",
          totalAmount: 1500,
          cashAmount: 1000,
          cardAmount: 500,
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "booking.complete" }),
      })
    );
  });

  // T4 (AC-4): 100% discount with reason → cash=0, card=0 OK
  it("succeeds with 100% discount and discountReason='permanent_client', no payment required", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });
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
    // booking.complete + booking.discount_applied → 2 audit log writes
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });

  // T5 (AC-5): totalBill === 0 (no priceList, no totalPrice in metadata) → succeeds
  it("succeeds when totalBill === 0 (no priceList, no pricePerHour)", async () => {
    setupPayableBooking({ totalPrice: "0.00" });

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

  // T6 (AC-6): race condition → ALREADY_COMPLETED (after gate passes)
  it("throws ALREADY_COMPLETED when concurrent writer already completed (updateMany count=0)", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      updateBookingStatus("booking-1", "COMPLETED", "manager-1", undefined, 1500, 0)
    ).rejects.toMatchObject({
      code: "ALREADY_COMPLETED",
    });
  });

  // T7: snapshot totalPrice is used, NOT recomputed from pricePerHour × hours
  it("uses metadata.totalPrice snapshot (NOT pricePerHour × hours)", async () => {
    // metadata.totalPrice=1800 (day rate), pricePerHour=500 × 4h = 2000.
    // Gate must use 1800, not 2000 — snapshot is source of truth.
    setupPayableBooking({ totalPrice: "1800.00" });

    await expect(
      updateBookingStatus("booking-1", "COMPLETED", "manager-1", undefined, 1800, 0)
    ).resolves.toBeDefined();

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalAmount: 1800 }),
      })
    );
  });

  // T8: overpayment is allowed (cash change handed by manager)
  it("succeeds when cardAmount exceeds totalBill (overpayment)", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });

    await updateBookingStatus(
      "booking-1",
      "COMPLETED",
      "manager-1",
      undefined,
      0,
      2000
    );

    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cashAmount: 0,
          cardAmount: 2000,
        }),
      })
    );
  });

  // T9 (CRON regression): not used today in gazebos but guarded for future
  it("CRON auto-complete bypasses PAYMENT_REQUIRED gate even when totalBill > 0", async () => {
    setupPayableBooking({ totalPrice: "1500.00" });

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
          totalAmount: 1500,
          cashAmount: 1500,
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "booking.auto_complete",
          metadata: expect.objectContaining({ actor: "CRON" }),
        }),
      })
    );
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

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].slots).toHaveLength(15); // hours 8,9,10,...,22 = 15 slots
  });

  it("includes minBookingHours in response", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);

    expect(result.minBookingHours).toBe(4);
  });

  it("marks all slots as available when no bookings exist", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);

    expect(result.resources[0].slots.every((s) => s.isAvailable)).toBe(true);
  });

  it("marks slot as unavailable when a booking overlaps", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      mockBooking({
        // 10:00–11:00 Moscow = 07:00Z–08:00Z (stored in UTC).
        startTime: new Date(`${FUTURE_DATE}T07:00:00.000Z`),
        endTime: new Date(`${FUTURE_DATE}T08:00:00.000Z`),
        status: "CONFIRMED",
      }),
    ] as never);

    const result = await getAvailability(FUTURE_DATE);
    const slot10 = result.resources[0].slots.find((s) => s.startTime === "10:00");

    expect(slot10?.isAvailable).toBe(false);
  });

  it("returns correct slot time labels (first: 08:00, last: 22:00)", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result.resources[0].slots;

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

// ===== #434: настройки модуля читаются сервисом =====
//
// До фикса openHour/closeHour/maxBookingHours были захардкожены — форма
// настроек их валидировала и сохраняла, но ни один сервис не читал.
describe("getAvailability уважает openHour/closeHour/maxBookingHours из настроек (#434)", () => {
  it("генерирует слоты по openHour/closeHour из Module.config, а не по хардкоду 8–23", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { openHour: 10, closeHour: 18 },
    } as never);

    const result = await getAvailability(FUTURE_DATE);
    const slots = result.resources[0].slots;

    expect(slots).toHaveLength(8); // 10,11,...,17
    expect(slots[0].startTime).toBe("10:00");
    expect(slots[slots.length - 1].endTime).toBe("18:00");
  });

  it("отдаёт openHour/closeHour/maxBookingHours в ответе", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { openHour: 9, closeHour: 21, maxBookingHours: 6 },
    } as never);

    const result = await getAvailability(FUTURE_DATE);

    expect(result.openHour).toBe(9);
    expect(result.closeHour).toBe(21);
    expect(result.maxBookingHours).toBe(6);
  });

  it("падает обратно на 8–23, если openHour/closeHour не настроены", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);

    const result = await getAvailability(FUTURE_DATE);

    expect(result.openHour).toBe(8);
    expect(result.closeHour).toBe(23);
  });
});

// === ADMIN BOOKING ===

const validAdminInput = {
  resourceId: "resource-1",
  date: FUTURE_DATE,
  startTime: "10:00",
  endTime: "14:00", // 4 hours — meets minimum
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
          userId: "client-1",
          managerId: "admin-1",
          clientName: "Иванов Иван",
          clientPhone: "+7 999 123-45-67",
          metadata: expect.objectContaining({ bookedByAdmin: true }),
        }),
      })
    );
  });

  it("сохраняет email в metadata, когда указан (issue #665)", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED" }) as never);

    await createAdminBooking("admin-1", { ...validAdminInput, email: "guest@example.com" });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ email: "guest@example.com" }),
        }),
      })
    );
  });

  it("не пишет email в metadata, когда не указан (issue #665)", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED" }) as never);

    await createAdminBooking("admin-1", validAdminInput);

    const call = vi.mocked(prisma.booking.create).mock.calls[0][0];
    expect((call.data as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty("email");
  });

  // #430: телефонные брони беседок не создавали карточку гостя в CRM — бронь
  // писалась на userId=adminId без upsertClientByPhone. Эталон — ps-park.
  it("дедуплицирует гостя по телефону через upsertClientByPhone", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED" }) as never);

    await createAdminBooking("admin-1", validAdminInput);

    expect(upsertClientByPhone).toHaveBeenCalledWith("+7 999 123-45-67", {
      name: "Иванов Иван",
      source: "gazebos_booking",
    });
  });

  it("throws DURATION_BELOW_MIN when admin booking is shorter than minBookingHours", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(
      createAdminBooking("admin-1", { ...validAdminInput, startTime: "10:00", endTime: "12:00" }) // 2h < 4h
    ).rejects.toMatchObject({ code: "DURATION_BELOW_MIN" });
  });

  // #434: maxBookingHours не применялся нигде, включая админ-бронь.
  it("throws DURATION_ABOVE_MAX when admin booking exceeds maxBookingHours (default 8h)", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(
      createAdminBooking("admin-1", { ...validAdminInput, startTime: "08:00", endTime: "18:00" }) // 10h > 8h
    ).rejects.toMatchObject({ code: "DURATION_ABOVE_MAX" });
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
        userId: "client-1",
      })
    );
  });

  // #437: booking.confirmed не постится в канал смены (шаблон убран для
  // публичных PENDING→CONFIRMED), поэтому брони по телефону нужен отдельный
  // канал-only тип события с данными клиента для шаблона.
  it("should enqueue a separate booking.admin_created event for the shift channel", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED", id: "new-booking" }) as never);

    await createAdminBooking("admin-1", validAdminInput);

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.admin_created",
        moduleSlug: "gazebos",
        entityId: "new-booking",
        userId: "client-1",
        data: expect.objectContaining({
          clientName: "Иванов Иван",
          clientPhone: "+7 999 123-45-67",
          bookingId: "new-booking",
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

  // Этот тест ловит конфликт на внешнем pre-check, поэтому до транзакции дело не
  // доходит и авторитетная проверка под блокировкой не исполняется. Ниже —
  // сценарий именно для неё: снаружи свободно, под локом занято (#429).
  it("отказывает, если конфликт нашёлся только под блокировкой слота", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(null) // внешний pre-check: свободно
      .mockResolvedValueOnce(mockBooking() as never); // под локом: занято

    await expect(createAdminBooking("admin-1", validAdminInput))
      .rejects.toThrow("Это время уже занято");

    expect(txExecuteRaw).toHaveBeenCalled();
    expect(prisma.booking.create).not.toHaveBeenCalled();
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

  // Тест раньше закреплял сам баг: требовал ровно ["PENDING","CONFIRMED"] и тем
  // самым фиксировал отсутствие CHECKED_IN как ожидаемое поведение. Заехавший
  // гость выпадал из сетки, слот выглядел свободным, менеджер бронировал поверх (#424).
  it("включает занимающие слот статусы, в том числе CHECKED_IN", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    await getTimeline(FUTURE_DATE);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ACTIVE_BOOKING_STATUSES },
        }),
      })
    );
    expect(ACTIVE_BOOKING_STATUSES).toContain("CHECKED_IN");
  });

  it("не держит освободившиеся слоты: COMPLETED, CANCELLED и NO_SHOW вне выборки", () => {
    expect(ACTIVE_BOOKING_STATUSES).not.toContain("COMPLETED");
    expect(ACTIVE_BOOKING_STATUSES).not.toContain("CANCELLED");
    expect(ACTIVE_BOOKING_STATUSES).not.toContain("NO_SHOW");
  });
});

describe("getTimeline уважает openHour/closeHour из настроек (#434)", () => {
  it("столбцы hours строятся по Module.config, а не по хардкоду 8–23", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { openHour: 9, closeHour: 20 },
    } as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.hours).toHaveLength(11); // 9,10,...,19
    expect(result.hours[0]).toBe("09:00");
    expect(result.hours[result.hours.length - 1]).toBe("19:00");
  });
});

// #523: quick-booking-popover.tsx hardcoded MIN_BOOKING_HOURS=4 instead of
// reading it from Module.config — getTimeline() now carries the real value.
describe("getTimeline carries minBookingHours from settings (#523)", () => {
  it("returns minBookingHours from Module.config", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { minBookingHours: 2 },
    } as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.minBookingHours).toBe(2);
  });

  it("falls back to the default when Module.config has no minBookingHours", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);

    const result = await getTimeline(FUTURE_DATE);

    expect(result.minBookingHours).toBe(4);
  });
});

// === Analytics Tests ===

describe("getAnalytics", () => {
  beforeEach(() => {
    // Default: no money received. Individual tests override as needed.
    vi.mocked(prisma.financialTransaction.aggregate).mockResolvedValue({
      _sum: { totalAmount: null },
    } as never);
  });

  it("should return analytics for a period with no bookings", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);

    const result = await getAnalytics("month");

    expect(result.totalBookings).toBe(0);
    expect(result.totalReceived).toBe(0);
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

  it("reports totalReceived from financial transactions independent of booking status", async () => {
    // Money can arrive (e.g. YooKassa) while the booking is still CONFIRMED,
    // not COMPLETED — so received revenue must not depend on totalRevenue.
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      mockBooking({ id: "b1", status: "CONFIRMED", resource: mockResource() }),
    ] as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.financialTransaction.aggregate).mockResolvedValue({
      _sum: { totalAmount: 4000 },
    } as never);

    const result = await getAnalytics("month");

    expect(result.totalReceived).toBe(4000); // касса
    expect(result.totalRevenue).toBe(0); // нет завершённых броней
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

  // #438: «гость звонит: я бронировал» — найти бронь по имени/телефону.
  it("should apply search filter across clientName and clientPhone (case-insensitive)", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookingsPaginated({ search: "Иванов" });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { clientName: { contains: "Иванов", mode: "insensitive" } },
            { clientPhone: { contains: "Иванов", mode: "insensitive" } },
          ],
        }),
      })
    );
  });

  it("should not add OR clause when search is empty", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookingsPaginated({ status: "COMPLETED" });

    const call = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    expect(call?.where).not.toHaveProperty("OR");
  });

  // #509: bookingFilterSchema validates userId, but listBookingsPaginated
  // silently dropped it instead of filtering — this pins the fix.
  it("should apply userId filter", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookingsPaginated({ userId: "user-42" });

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-42" }),
      })
    );
  });

  it("should not add userId to where when not provided", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookingsPaginated({ status: "COMPLETED" });

    const call = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    expect(call?.where).not.toHaveProperty("userId");
  });
});

// ===== rescheduleBooking =====
// 2030-06-15 = суббота (выходной), 2030-06-17 = понедельник (будни).
const WEEKEND_DATE = "2030-06-15";

const priceListResource = () =>
  mockResource({
    pricePerHour: 1000,
    metadata: {
      priceList: {
        weekdayHour: 1000,
        weekdayDay: 10000,
        weekendHour: 1500,
        weekendDay: 15000,
      },
    },
  });

describe("rescheduleBooking", () => {
  it("recomputes weekend price on a time change and writes an audit record", async () => {
    const booking = mockBooking({
      status: "CONFIRMED",
      date: new Date(WEEKEND_DATE),
      startTime: new Date(`${WEEKEND_DATE}T10:00:00+03:00`),
      endTime: new Date(`${WEEKEND_DATE}T14:00:00+03:00`),
      metadata: { totalPrice: "6000.00", basePrice: "6000.00", pricePerHour: "1500.00" },
    });
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(booking as never) // load
      .mockResolvedValueOnce(null as never); // no conflict
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(priceListResource() as never);
    vi.mocked(prisma.booking.update).mockResolvedValue({ ...booking } as never);

    await rescheduleBooking("booking-1", { endTime: "16:00" }, "manager-1");

    // 6 ч × 1500 (выходной) = 9000, дневной тариф 15000 не применяется.
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            totalPrice: "9000.00",
            pricePerHour: "1500.00",
          }),
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "booking.reschedule",
          entity: "Booking",
          entityId: "booking-1",
        }),
      })
    );
  });

  it("rejects a reschedule that conflicts with another booking", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({ status: "CONFIRMED", metadata: {} }) as never
      )
      .mockResolvedValueOnce(mockBooking({ id: "other" }) as never);
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);

    await expect(
      rescheduleBooking("booking-1", { startTime: "10:00", endTime: "15:00" }, "m1")
    ).rejects.toThrow("Это время уже занято");
  });

  it("refuses to edit a completed booking", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(
      mockBooking({ status: "COMPLETED" }) as never
    );

    await expect(
      rescheduleBooking("booking-1", { endTime: "16:00" }, "m1")
    ).rejects.toThrow("активные брони");
  });

  // #434: часы работы и максимальная длительность были захардкожены.
  it("OUTSIDE_WORKING_HOURS уважает настроенные openHour/closeHour, а не хардкод 8–23", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(
      mockBooking({ status: "CONFIRMED" }) as never
    );
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { openHour: 10, closeHour: 20, minBookingHours: 4 },
    } as never);

    // 09:00 — до настроенного openHour=10, хотя это внутри старого хардкода 8–23.
    await expect(
      rescheduleBooking("booking-1", { startTime: "09:00", endTime: "13:00" }, "m1")
    ).rejects.toMatchObject({ code: "OUTSIDE_WORKING_HOURS" });
  });

  it("DURATION_ABOVE_MAX уважает настроенный maxBookingHours", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(
      mockBooking({ status: "CONFIRMED" }) as never
    );
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { minBookingHours: 1, maxBookingHours: 5 },
    } as never);

    await expect(
      rescheduleBooking("booking-1", { startTime: "10:00", endTime: "16:00" }, "m1") // 6ч > 5ч
    ).rejects.toMatchObject({ code: "DURATION_ABOVE_MAX" });
  });
});

// ===== #433: Google Calendar + уведомление при переносе =====
//
// До фикса rescheduleBooking не вызывал updateCalendarEvent ни разу и не делал
// ни одного enqueueNotification — после переноса времени событие GCal оставалось
// на старом слоте, клиент и Telegram-канал не узнавали об изменении.
describe("перенос синхронизирует Google Calendar и уведомляет (#433)", () => {
  it("патчит то же событие в календаре при переносе времени на том же ресурсе", async () => {
    // +03:00 явно: формат "10:00" без офсета парсится как UTC, а не Moscow, и
    // 2ч между таким "10:00" и Moscow-инстантом "15:00" не проходят DURATION_BELOW_MIN.
    const booking = mockBooking({
      status: "CONFIRMED",
      googleEventId: "gcal-1",
      startTime: new Date(`${FUTURE_DATE}T10:00:00+03:00`),
      endTime: new Date(`${FUTURE_DATE}T11:00:00+03:00`),
    });
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(booking as never) // load
      .mockResolvedValueOnce(null as never); // no conflict
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(
      mockResource({ googleCalendarId: "cal-1" }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(booking as never);

    await rescheduleBooking("booking-1", { endTime: "15:00" }, "manager-1");

    expect(updateCalendarEvent).toHaveBeenCalledWith(
      "cal-1",
      "gcal-1",
      expect.objectContaining({
        startTime: expect.any(Date),
        endTime: expect.any(Date),
      })
    );
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it("переносит событие между календарями при смене беседки", async () => {
    const booking = mockBooking({
      status: "CONFIRMED",
      googleEventId: "gcal-1",
      resourceId: "resource-1",
      startTime: new Date(`${FUTURE_DATE}T10:00:00`),
      endTime: new Date(`${FUTURE_DATE}T15:00:00`), // 5ч — проходит DURATION_BELOW_MIN
    });
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(booking as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.resource.findFirst).mockImplementation((async (args: {
      where?: { id?: string };
    }) => {
      const id = args?.where?.id;
      if (id === "resource-2") return mockResource({ id: "resource-2", name: "Беседка №2", googleCalendarId: "cal-2" });
      if (id === "resource-1") return mockResource({ id: "resource-1", name: "Беседка №1", googleCalendarId: "cal-1" });
      return null;
    }) as never);
    vi.mocked(createCalendarEvent).mockResolvedValueOnce({ success: true, eventId: "gcal-2" } as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(booking as never);

    await rescheduleBooking("booking-1", { resourceId: "resource-2" }, "manager-1");

    expect(deleteCalendarEvent).toHaveBeenCalledWith("cal-1", "gcal-1");
    expect(createCalendarEvent).toHaveBeenCalledWith(
      "cal-2",
      expect.objectContaining({ startTime: expect.any(Date), endTime: expect.any(Date) })
    );
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ googleEventId: "gcal-2" }),
      })
    );
  });

  it("не трогает календарь, если у брони не было googleEventId", async () => {
    const booking = mockBooking({
      status: "CONFIRMED",
      startTime: new Date(`${FUTURE_DATE}T10:00:00+03:00`),
      endTime: new Date(`${FUTURE_DATE}T11:00:00+03:00`),
    }); // no googleEventId
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(booking as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(
      mockResource({ googleCalendarId: "cal-1" }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(booking as never);

    await rescheduleBooking("booking-1", { endTime: "15:00" }, "manager-1");

    expect(updateCalendarEvent).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it("не трогает календарь при BOOKING_CONFLICT — конфликт-чек идёт раньше синка", async () => {
    // Регрессия на находку код-ревью: до фикса календарь трогали ДО
    // конфликт-чека внутри транзакции — отклонённый перенос всё равно патчил
    // время или удалял валидное событие без замены (осиротевшая запись).
    const booking = mockBooking({
      status: "CONFIRMED",
      googleEventId: "gcal-1",
      startTime: new Date(`${FUTURE_DATE}T10:00:00+03:00`),
      endTime: new Date(`${FUTURE_DATE}T11:00:00+03:00`),
    });
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(booking as never) // load
      .mockResolvedValueOnce(mockBooking({ id: "other" }) as never); // conflict under lock
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(
      mockResource({ googleCalendarId: "cal-1" }) as never
    );

    await expect(
      rescheduleBooking("booking-1", { endTime: "15:00" }, "manager-1")
    ).rejects.toThrow("Это время уже занято");

    expect(updateCalendarEvent).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("шлёт booking.rescheduled клиенту при переносе времени/ресурса", async () => {
    // Явный +03:00: mockBooking() без офсета хранит "10:00" как UTC (13:00 Moscow),
    // а formatTime() всегда показывает Moscow — нужен настоящий Moscow-инстант,
    // чтобы oldStartTime/oldEndTime совпали с ожидаемой строкой.
    const booking = mockBooking({
      status: "CONFIRMED",
      userId: "user-1",
      startTime: new Date(`${FUTURE_DATE}T10:00:00+03:00`),
      endTime: new Date(`${FUTURE_DATE}T11:00:00+03:00`),
    });
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(booking as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(booking as never);

    await rescheduleBooking("booking-1", { endTime: "15:00" }, "manager-1");

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "booking.rescheduled",
        moduleSlug: "gazebos",
        entityId: "booking-1",
        userId: "user-1",
        data: expect.objectContaining({
          oldStartTime: "10:00",
          oldEndTime: "11:00",
          startTime: "10:00",
          endTime: "15:00",
        }),
      })
    );
  });

  it("не шлёт booking.rescheduled, если время и ресурс не менялись", async () => {
    const booking = mockBooking({
      status: "CONFIRMED",
      userId: "user-1",
      startTime: new Date(`${FUTURE_DATE}T10:00:00`),
      endTime: new Date(`${FUTURE_DATE}T15:00:00`), // 5ч — проходит DURATION_BELOW_MIN
    });
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(booking as never);
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(booking as never);

    await rescheduleBooking("booking-1", { clientName: "Новое имя" }, "manager-1");

    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});

// ===== createBooking public-booking gate =====

describe("createBooking public gate", () => {
  it("blocks public booking when disabled in module config", async () => {
    // Действует только на этот вызов (createBooking падает до getMinBookingHours).
    vi.mocked(prisma.module.findUnique).mockResolvedValueOnce({
      config: { publicBookingEnabled: false },
    } as never);

    await expect(createBooking("user-1", validBookingInput)).rejects.toThrow(
      "временно недоступно"
    );
  });
});

// ===== #429: конфликт-чек и запись под блокировкой слота =====
//
// Эти тесты падали бы до фикса: чек делался через prisma вне транзакции, поэтому
// ни $transaction, ни advisory-блокировки в createBooking не было вовсе.
describe("сериализация слота (#429)", () => {
  it("createBooking делает чек и запись в одной транзакции под блокировкой", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txExecuteRaw).toHaveBeenCalled();
  });

  it("createBooking не пишет бронь, если конфликт нашёлся уже под блокировкой", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    // Гонка: снаружи было свободно, но к моменту блокировки слот занят.
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(mockBooking() as never);

    await expect(createBooking("user-1", validBookingInput)).rejects.toThrow("уже занято");
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("rescheduleBooking блокирует целевой слот при смене времени", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(mockBooking() as never) // саму бронь нашли
      .mockResolvedValueOnce(null); // конфликтов на новом слоте нет
    // Именно findFirst: rescheduleBooking ищет ресурс через него, а findUnique в
    // gazebos/service.ts не используется вообще. С findUnique тест проходил только
    // за счёт утечки мока из соседнего теста — clearAllMocks() чистит историю
    // вызовов, но не реализацию, — и в одиночном прогоне падал.
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking() as never);

    await rescheduleBooking(
      "booking-1",
      { date: FUTURE_DATE, startTime: "16:00", endTime: "20:00" },
      "manager-1"
    );

    expect(txExecuteRaw).toHaveBeenCalled();
  });
});

// ===== #424: CHECKED_IN занимает слот =====
//
// До фикса конфликт-чеки фильтровали ["PENDING","CONFIRMED"], поэтому заехавший
// гость был невидим: слот считался свободным и менеджер бронировал поверх него.
describe("CHECKED_IN занимает слот (#424)", () => {
  it("createBooking отказывает, если слот занят заехавшим гостем", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    // Мок эмулирует фильтрацию Prisma: заехавший гость «найдётся» только если
    // запрос действительно спросил CHECKED_IN. С безусловным mockResolvedValue
    // тест проходил бы и на старом коде — он проверял бы «падаем, когда БД
    // вернула конфликт», а не «спрашиваем у БД правильный список статусов».
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
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ACTIVE_BOOKING_STATUSES } }),
      })
    );
  });

  it("getAvailability не отдаёт как свободный слот с заехавшим гостем", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    await getAvailability(FUTURE_DATE);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ACTIVE_BOOKING_STATUSES } }),
      })
    );
  });
});

// ===== #478: NO_SHOW → CHECKED_IN не проверял занятость слота =====
//
// Слот честно освобождается, когда бронь уходит в NO_SHOW (#424, #429), и мог
// быть отдан другому гостю. До фикса реактивация неявки была голым update без
// конфликт-чека и блокировки — опоздавший гость создавал двойную бронь.
describe("NO_SHOW → CHECKED_IN конфликт-чек (#478)", () => {
  it("проходит на свободный слот (регрессия на фичу позднего заезда)", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({ status: "NO_SHOW", startTime: new Date(`${FUTURE_DATE}T10:00:00`) }) as never
      ) // саму бронь нашли
      .mockResolvedValueOnce(null); // слот свободен под блокировкой
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "CHECKED_IN" }) as never);

    await checkInBooking("booking-1", "manager-1");

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txExecuteRaw).toHaveBeenCalled();
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CHECKED_IN", managerId: "manager-1" }),
      })
    );
  });

  it("отдаёт BOOKING_CONFLICT и не меняет статус, если слот уже занят другой бронью", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(
        mockBooking({ status: "NO_SHOW", startTime: new Date(`${FUTURE_DATE}T10:00:00`) }) as never
      ) // саму бронь нашли
      .mockResolvedValueOnce(mockBooking({ id: "booking-2", status: "CONFIRMED" }) as never); // конфликт под блокировкой

    await expect(checkInBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_CONFLICT",
    });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it("CONFIRMED → CHECKED_IN не берёт лишней блокировки слота (уже занимал его)", async () => {
    const pastStart = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago — условие перехода
    vi.mocked(prisma.booking.findFirst).mockResolvedValueOnce(
      mockBooking({ status: "CONFIRMED", startTime: pastStart }) as never
    );
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "CHECKED_IN" }) as never);

    await checkInBooking("booking-1", "manager-1");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ===== #423: soft-deleted брони исключены из чтения =====
//
// До фикса `deletedAt: null` стоял только в rescheduleBooking — удалённая через
// админку бронь навсегда блокировала слот (конфликт-чек её видел), возвращалась
// в списки после перезагрузки и попадала в аналитику.
describe("soft-delete filter (deletedAt: null) в чтениях (#423)", () => {
  it("listBookings добавляет deletedAt: null в where", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);

    await listBookings();

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, moduleSlug: "gazebos" }),
      })
    );
    expect(prisma.booking.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("getBooking фильтрует по deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await getBooking("some-id");

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("createBooking игнорирует soft-deleted брони в конфликт-чеке", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking() as never);

    await createBooking("user-1", validBookingInput);

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("createAdminBooking игнорирует soft-deleted брони в обоих конфликт-чеках", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.booking.create).mockResolvedValue(mockBooking({ status: "CONFIRMED" }) as never);

    await createAdminBooking("admin-1", validAdminInput);

    const calls = vi.mocked(prisma.booking.findFirst).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [args] of calls) {
      expect((args as { where: Record<string, unknown> }).where).toMatchObject({ deletedAt: null });
    }
  });

  it("updateBookingStatus ищет бронь с фильтром deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(updateBookingStatus("booking-1", "CONFIRMED")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("cancelBooking ищет бронь с фильтром deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(cancelBooking("booking-1", "user-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("checkInBooking ищет бронь с фильтром deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(checkInBooking("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("markNoShow ищет бронь с фильтром deletedAt: null", async () => {
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);

    await expect(markNoShow("booking-1", "manager-1")).rejects.toMatchObject({
      code: "BOOKING_NOT_FOUND",
    });

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  // #440: порог неявки был захардкожен `30` — markNoShow всегда проверял
  // ровно 30 минут после startTime, настройка Module.config.noShowThresholdMinutes
  // ни на что не влияла.
  describe("порог неявки конфигурируем (#440)", () => {
    it("уважает настроенный noShowThresholdMinutes из Module.config", async () => {
      vi.mocked(prisma.module.findUnique).mockResolvedValue({
        config: { noShowThresholdMinutes: 10 },
      } as never);
      const startedAgo = new Date(Date.now() - 15 * 60 * 1000); // 15 минут назад
      vi.mocked(prisma.booking.findFirst).mockResolvedValue(
        mockBooking({ status: "CONFIRMED", startTime: startedAgo }) as never
      );
      vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking({ status: "NO_SHOW" }) as never);

      // 15 минут прошло, порог настроен на 10 — переход должен пройти.
      await expect(markNoShow("booking-1", "manager-1")).resolves.toBeDefined();
    });

    it("без настройки использует дефолт 30 минут (DEFAULT_NO_SHOW_THRESHOLD_MINUTES)", async () => {
      vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);
      const startedAgo = new Date(Date.now() - 15 * 60 * 1000); // 15 минут назад
      vi.mocked(prisma.booking.findFirst).mockResolvedValue(
        mockBooking({ status: "CONFIRMED", startTime: startedAgo }) as never
      );

      // 15 минут прошло, дефолтный порог — 30: переход должен отклоняться.
      await expect(markNoShow("booking-1", "manager-1")).rejects.toMatchObject({
        code: "TRANSITION_CONDITION_NOT_MET",
      });
    });
  });

  it("getAvailability не блокирует слот soft-deleted бронью", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    const result = await getAvailability(FUTURE_DATE);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
    // С нулём (не считая soft-deleted) броней каждый слот свободен.
    expect(result.resources[0].slots.every((s) => s.isAvailable)).toBe(true);
  });

  it("getTimeline фильтрует soft-deleted брони", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);

    await getTimeline(FUTURE_DATE);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("getAnalytics фильтрует soft-deleted брони", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([mockResource()] as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.financialTransaction.aggregate).mockResolvedValue({
      _sum: { totalAmount: null },
    } as never);

    await getAnalytics("month");

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("listBookingsPaginated фильтрует soft-deleted брони", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.booking.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listBookingsPaginated({});

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("rescheduleBooking игнорирует soft-deleted брони в конфликт-чеке целевого слота", async () => {
    vi.mocked(prisma.booking.findFirst)
      .mockResolvedValueOnce(mockBooking() as never) // саму бронь нашли
      .mockResolvedValueOnce(null as never); // конфликтов (среди живых) на новом слоте нет
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(mockResource() as never);
    vi.mocked(prisma.booking.update).mockResolvedValue(mockBooking() as never);

    await rescheduleBooking(
      "booking-1",
      { date: FUTURE_DATE, startTime: "16:00", endTime: "20:00" },
      "manager-1"
    );

    // Второй вызов findFirst — это конфликт-чек внутри транзакции переноса.
    expect(prisma.booking.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });
});
