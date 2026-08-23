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
    offerVersion: { findUnique: vi.fn() },
  },
}));

const mockSendEmail = vi.fn().mockResolvedValue({ success: true });
vi.mock("@/modules/notifications/channels/email", () => ({
  sendTransactionalEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  process.env.AUTH_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://delovoy-park.ru";
  mockSendEmail.mockResolvedValue({ success: true });
  vi.mocked(prisma.resource.findUnique).mockResolvedValue({
    name: "Беседка №1",
    googleCalendarId: null,
  } as never);
  vi.mocked(prisma.offerVersion.findUnique).mockResolvedValue({
    number: 1,
    slug: "v1",
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

// === ПИСЬМО-ПОДТВЕРЖДЕНИЕ (ТЗ §7) ===

describe("afterBookingPaymentSucceeded — письмо-подтверждение", () => {
  const paidBooking = () =>
    booking({
      offerVersionId: "ov-1",
      metadata: {
        basePrice: "8400.00",
        totalPrice: "8800.00",
        items: [{ name: "Уголь", quantity: 1, price: "400.00" }],
      },
    });

  it("шлёт письмо на адрес из платежа", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);

    await afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe("guest@example.com");
  });

  it("ведёт на конкретную редакцию оферты, а не на /oferta", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);

    await afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }));

    const { html, text } = mockSendEmail.mock.calls[0][0];
    expect(html).toContain("/oferta/v/v1");
    expect(text).toContain("/oferta/v/v1");
    expect(html).toContain("редакции № 1");
  });

  it("несёт номер брони, позиции с ценами и итог", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);

    await afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }));

    const { subject, html } = mockSendEmail.mock.calls[0][0];
    expect(subject).toContain("БП-BOOK1");
    expect(html).toContain("Аренда беседки");
    expect(html).toContain("Уголь × 1");
    // toLocaleString("ru-RU") разделяет разряды неразрывным пробелом.
    expect(String(html).replace(/\u00a0/g, " ")).toContain("8 800 ₽");
  });

  it("несёт ссылку на управление бронью", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);

    await afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }));

    expect(mockSendEmail.mock.calls[0][0].html).toContain(
      "https://delovoy-park.ru/booking/"
    );
  });

  it("повторяет условия отмены с экрана оплаты дословно", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);

    await afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }));

    const { html } = mockSendEmail.mock.calls[0][0];
    const { buildCancellationSummary } = await import("@/modules/booking/cancellation-summary");
    for (const line of buildCancellationSummary().lines) {
      expect(html).toContain(line);
    }
  });

  it("без адреса письмо не шлёт и обработку платежа не роняет", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);

    await expect(
      afterBookingPaymentSucceeded(payment({ customerEmail: null }))
    ).resolves.toBeUndefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("не шлёт письмо по броням ps-park — у них своя оферта", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      booking({ moduleSlug: "ps-park", status: "CHECKED_IN", offerVersionId: "ov-1" }) as never
    );

    await afterBookingPaymentSucceeded(
      payment({ moduleSlug: "ps-park", customerEmail: "guest@example.com" })
    );

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("не шлёт письмо без привязки к редакции — его главный груз в ней", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(
      booking({ offerVersionId: null, metadata: { totalPrice: "8800.00" } }) as never
    );

    await afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }));

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("сбой отправки не роняет обработку платежа", async () => {
    vi.mocked(prisma.booking.findUnique).mockResolvedValue(paidBooking() as never);
    mockSendEmail.mockRejectedValue(new Error("SMTP down"));

    await expect(
      afterBookingPaymentSucceeded(payment({ customerEmail: "guest@example.com" }))
    ).resolves.toBeUndefined();
  });
});
