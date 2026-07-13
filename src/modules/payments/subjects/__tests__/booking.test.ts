import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Payment } from "@prisma/client";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/lib/google-calendar", () => ({
  createCalendarEvent: vi.fn().mockResolvedValue({ success: false }),
}));

vi.mock("@/modules/inventory/service", () => ({
  saleBookingItems: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    resource: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/modules/notifications/queue";
import { afterBookingPaymentSucceeded } from "../booking";

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    subjectType: "BOOKING",
    subjectId: "book1",
    moduleSlug: "gazebos",
    amount: 1500 as never,
    userId: "u1",
    ...overrides,
  } as Payment;
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "book1",
    moduleSlug: "gazebos",
    status: "CONFIRMED",
    resourceId: "res1",
    userId: "u1",
    clientName: "Иванов",
    clientPhone: null,
    googleEventId: "evt1", // уже есть, чтобы не дёргать календарь
    date: new Date("2026-07-15T00:00:00.000Z"),
    startTime: new Date("2026-07-15T10:00:00.000Z"),
    endTime: new Date("2026-07-15T14:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.resource.findUnique).mockResolvedValue({
    name: "Беседка №1",
    googleCalendarId: null,
  } as never);
});

describe("afterBookingPaymentSucceeded — эмит booking.paid", () => {
  it("gazebos CONFIRMED: шлёт и booking.confirmed (клиент), и booking.paid (канал)", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(booking() as never);

    await afterBookingPaymentSucceeded(payment());

    const types = vi.mocked(enqueueNotification).mock.calls.map((c) => c[0].type);
    expect(types).toContain("booking.confirmed");
    expect(types).toContain("booking.paid");

    const paid = vi
      .mocked(enqueueNotification)
      .mock.calls.find((c) => c[0].type === "booking.paid")![0];
    expect(paid.moduleSlug).toBe("gazebos");
    expect(paid.entityId).toBe("book1");
    expect(paid.data.bookingId).toBe("book1");
    expect(paid.data.amount).toContain("1"); // отформатированная сумма
    expect(paid.data.resourceName).toBe("Беседка №1");
  });

  it("ps-park: шлёт booking.paid, но НЕ booking.confirmed (статус не менялся)", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      booking({ moduleSlug: "ps-park", status: "CHECKED_IN" }) as never
    );

    await afterBookingPaymentSucceeded(payment({ moduleSlug: "ps-park" }));

    const types = vi.mocked(enqueueNotification).mock.calls.map((c) => c[0].type);
    expect(types).toContain("booking.paid");
    expect(types).not.toContain("booking.confirmed");

    const paid = vi
      .mocked(enqueueNotification)
      .mock.calls.find((c) => c[0].type === "booking.paid")![0];
    expect(paid.moduleSlug).toBe("ps-park");
  });

  it("бронь не найдена → ничего не шлёт", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(null as never);
    await afterBookingPaymentSucceeded(payment());
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});
