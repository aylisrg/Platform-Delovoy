import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Payment } from "@prisma/client";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/lib/google-calendar", () => ({
  createCalendarEvent: vi.fn().mockResolvedValue({ success: false }),
  deleteCalendarEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/modules/inventory/service", () => ({
  saleBookingItems: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
  logAudit: vi.fn(),
}));

vi.mock("@/lib/yookassa/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/yookassa/client")>();
  return {
    ...actual,
    isYooKassaConfigured: vi.fn(() => true),
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    cancelPayment: vi.fn(),
    createRefund: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    paymentRefund: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    subscriptionTransaction: { create: vi.fn() },
    order: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    financialTransaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    systemEvent: { create: vi.fn() },
    resource: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma: p } = await import("@/lib/db");
      return fn(p);
    }),
  },
}));

import { prisma } from "@/lib/db";
import { createPayment as yooCreate, getPayment as yooGet, createRefund as yooRefund, isYooKassaConfigured, YooKassaError } from "@/lib/yookassa/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import {
  createOnlinePayment,
  syncPaymentByProviderId,
  refundPayment,
  autoRefundOnCancellation,
  getBookingPaymentSummaries,
  getBookingPaymentDetail,
  getPublicPaymentStatus,
} from "../service";

function paymentRow(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    provider: "yookassa",
    providerPaymentId: "yk1",
    status: "PENDING",
    amount: 1500 as never,
    refundedAmount: 0 as never,
    currency: "RUB",
    subjectType: "BOOKING",
    subjectId: "book1",
    moduleSlug: "gazebos",
    userId: "user1",
    createdById: null,
    confirmationUrl: "https://yookassa.example/pay",
    description: "Беседка: №1",
    idempotenceKey: "idem-1",
    paymentMethodType: null,
    cancellationReason: null,
    customerEmail: "guest@example.com",
    customerPhone: null,
    isTest: true,
    metadata: null,
    paidAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Payment;
}

const remoteSucceeded = {
  id: "yk1",
  status: "succeeded" as const,
  paid: true,
  amount: { value: "1500.00", currency: "RUB" },
  payment_method: { type: "bank_card" },
  created_at: "2026-07-09T10:00:00.000Z",
  captured_at: "2026-07-09T10:01:00.000Z",
  test: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isYooKassaConfigured).mockReturnValue(true);
  delete process.env.YOOKASSA_RECEIPTS_ENABLED;
});

afterEach(() => {
  delete process.env.YOOKASSA_RECEIPTS_ENABLED;
});

describe("createOnlinePayment", () => {
  const input = {
    subjectType: "BOOKING" as const,
    subjectId: "book1",
    moduleSlug: "gazebos",
    amount: 1500,
    description: "Беседка: №1, 2026-07-15 10:00–14:00",
    userId: "user1",
    customerEmail: "guest@example.com",
    receiptItems: [{ description: "Аренда беседки", amount: 1500 }],
    returnUrl: "https://park.example/payments/{paymentId}",
  };

  it("создаёт платёж: idempotenceKey до запроса, {paymentId} в return_url, сохраняет providerPaymentId", async () => {
    vi.mocked(prisma.payment.create).mockResolvedValue(paymentRow({ providerPaymentId: null }));
    vi.mocked(yooCreate).mockResolvedValue({
      ...remoteSucceeded,
      status: "pending",
      confirmation: { type: "redirect", confirmation_url: "https://yookassa.example/pay" },
    } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue(paymentRow());

    const result = await createOnlinePayment(input);

    const createArgs = vi.mocked(prisma.payment.create).mock.calls[0][0];
    expect(createArgs.data.idempotenceKey).toBeTruthy();
    expect(vi.mocked(yooCreate).mock.calls[0][1]).toBe(createArgs.data.idempotenceKey);

    const requestBody = vi.mocked(yooCreate).mock.calls[0][0];
    expect(requestBody.confirmation.return_url).toBe("https://park.example/payments/pay1");
    expect(requestBody.amount).toEqual({ value: "1500.00", currency: "RUB" });
    expect(requestBody.capture).toBe(true);

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerPaymentId: "yk1" }),
      })
    );
    expect(result.id).toBe("pay1");
  });

  it("при недоступной ЮKassa бросает PAYMENTS_NOT_CONFIGURED", async () => {
    vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    await expect(createOnlinePayment(input)).rejects.toMatchObject({
      code: "PAYMENTS_NOT_CONFIGURED",
    });
  });

  it("при ошибке провайдера помечает платёж CANCELED и бросает PAYMENT_CREATE_FAILED", async () => {
    vi.mocked(prisma.payment.create).mockResolvedValue(paymentRow({ providerPaymentId: null }));
    vi.mocked(yooCreate).mockRejectedValue(new YooKassaError("invalid_request", "bad", 400));

    await expect(createOnlinePayment(input)).rejects.toMatchObject({
      code: "PAYMENT_CREATE_FAILED",
    });
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELED",
          cancellationReason: "create_failed: invalid_request",
        }),
      })
    );
  });

  it("при включённой фискализации без контакта бросает PAYMENT_CONTACT_REQUIRED", async () => {
    process.env.YOOKASSA_RECEIPTS_ENABLED = "true";
    await expect(
      createOnlinePayment({ ...input, customerEmail: undefined })
    ).rejects.toMatchObject({ code: "PAYMENT_CONTACT_REQUIRED" });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("отклоняет неположительную сумму", async () => {
    await expect(createOnlinePayment({ ...input, amount: 0 })).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
    });
  });
});

describe("syncPaymentByProviderId (вебхук с re-fetch)", () => {
  it("succeeded: CAS-переход, подтверждение брони, ONLINE_PAYMENT в леджер, уведомление", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow());
    vi.mocked(yooGet).mockResolvedValue(remoteSucceeded as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ status: "SUCCEEDED" })
    );
    const booking = {
      id: "book1",
      moduleSlug: "gazebos",
      status: "PENDING",
      resourceId: "res1",
      userId: "user1",
      clientName: null,
      clientPhone: null,
      googleEventId: null,
      metadata: { totalPrice: "1500.00" },
      date: new Date("2026-07-15"),
      startTime: new Date("2026-07-15T10:00:00Z"),
      endTime: new Date("2026-07-15T14:00:00Z"),
    };
    vi.mocked(prisma.booking.findUnique)
      .mockResolvedValueOnce(booking as never) // внутри транзакции
      .mockResolvedValueOnce({ ...booking, status: "CONFIRMED" } as never); // afterCommit
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.resource.findUnique).mockResolvedValue({
      name: "Беседка №1",
      googleCalendarId: null,
    } as never);

    await syncPaymentByProviderId("yk1");

    // переход только из нефинального статуса
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PENDING", "WAITING_FOR_CAPTURE"] },
        }),
        data: expect.objectContaining({ status: "SUCCEEDED", paymentMethodType: "bank_card" }),
      })
    );
    // бронь подтверждена
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "book1", status: "PENDING" },
        data: expect.objectContaining({ status: "CONFIRMED" }),
      })
    );
    // выручка в леджер
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "ONLINE_PAYMENT", bookingId: "book1" }),
      })
    );
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.succeeded" })
    );
  });

  it("повторный вебхук (CAS count=0) — no-op без дублей в леджере", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(yooGet).mockResolvedValue(remoteSucceeded as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 0 });

    await syncPaymentByProviderId("yk1");

    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("canceled: неоплаченная PENDING-бронь беседки отменяется, слот освобождается", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow());
    vi.mocked(yooGet).mockResolvedValue({
      ...remoteSucceeded,
      status: "canceled",
      paid: false,
      cancellation_details: { party: "yoo_money", reason: "expired_on_confirmation" },
    } as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ status: "CANCELED" })
    );
    vi.mocked(prisma.booking.findUnique).mockResolvedValue({
      id: "book1",
      moduleSlug: "gazebos",
      status: "PENDING",
      resourceId: "res1",
      userId: "user1",
      date: new Date(),
      startTime: new Date(),
      endTime: new Date(),
      metadata: {},
    } as never);
    vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 1 });

    await syncPaymentByProviderId("yk1");

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELED",
          cancellationReason: "expired_on_confirmation",
        }),
      })
    );
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });

  it("неизвестный providerPaymentId — warn без исключения", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null);
    await expect(syncPaymentByProviderId("unknown")).resolves.toBeUndefined();
    expect(yooGet).not.toHaveBeenCalled();
  });
});

describe("refundPayment", () => {
  it("возврат разрешён только для оплаченного платежа", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow({ status: "PENDING" }));
    await expect(
      refundPayment("pay1", { reason: "тест", performedById: "admin1", performedByName: "Admin" })
    ).rejects.toMatchObject({ code: "REFUND_NOT_ALLOWED" });
  });

  it("полный возврат: PaymentRefund → провайдер → REFUNDED + отрицательный REFUND в леджере", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(prisma.paymentRefund.create).mockResolvedValue({
      id: "ref1",
      paymentId: "pay1",
      amount: 1500,
      status: "pending",
    } as never);
    vi.mocked(yooRefund).mockResolvedValue({
      id: "ykref1",
      status: "succeeded",
      amount: { value: "1500.00", currency: "RUB" },
      payment_id: "yk1",
      created_at: "2026-07-09T10:05:00.000Z",
    } as never);
    vi.mocked(prisma.paymentRefund.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.paymentRefund.findUniqueOrThrow).mockResolvedValue({
      id: "ref1",
      paymentId: "pay1",
      amount: 1500,
      reason: "тест",
      createdById: "admin1",
      providerRefundId: "ykref1",
    } as never);
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ status: "SUCCEEDED" })
    );

    const refundId = await refundPayment("pay1", {
      reason: "тест",
      performedById: "admin1",
      performedByName: "Admin",
    });

    expect(refundId).toBe("ref1");
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUNDED", refundedAmount: 1500 }),
      })
    );
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "REFUND", totalAmount: -1500 }),
      })
    );
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.refund.succeeded" })
    );
  });

  it("insufficient_funds → понятная ошибка, локальный возврат отменён", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(prisma.paymentRefund.create).mockResolvedValue({ id: "ref1" } as never);
    vi.mocked(yooRefund).mockRejectedValue(
      new YooKassaError("insufficient_funds", "no money", 400)
    );

    await expect(
      refundPayment("pay1", { reason: "тест", performedById: "admin1", performedByName: "Admin" })
    ).rejects.toMatchObject({ code: "REFUND_INSUFFICIENT_FUNDS" });
    expect(prisma.paymentRefund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "canceled" } })
    );
  });
});

describe("autoRefundOnCancellation (политика владельца)", () => {
  it("отмена гостем ≤24 ч до начала — без возврата", async () => {
    const result = await autoRefundOnCancellation({
      subjectType: "BOOKING",
      subjectId: "book1",
      trigger: "client_cancellation",
      eventStartTime: new Date(Date.now() + 10 * 3_600_000), // через 10 часов
    });
    expect(result).toEqual({ refunded: false, reason: "within_24h" });
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it("отмена гостем >24 ч — полный автовозврат", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(prisma.paymentRefund.create).mockResolvedValue({ id: "ref1" } as never);
    vi.mocked(yooRefund).mockResolvedValue({
      id: "ykref1",
      status: "succeeded",
      amount: { value: "1500.00", currency: "RUB" },
      payment_id: "yk1",
      created_at: "2026-07-09T10:05:00.000Z",
    } as never);
    vi.mocked(prisma.paymentRefund.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.paymentRefund.findUniqueOrThrow).mockResolvedValue({
      id: "ref1",
      paymentId: "pay1",
      amount: 1500,
      reason: "auto",
      createdById: "system",
      providerRefundId: "ykref1",
    } as never);
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ status: "SUCCEEDED" })
    );

    const result = await autoRefundOnCancellation({
      subjectType: "BOOKING",
      subjectId: "book1",
      trigger: "client_cancellation",
      eventStartTime: new Date(Date.now() + 48 * 3_600_000), // через 48 часов
    });

    expect(result).toMatchObject({ refunded: true, refundId: "ref1" });
  });

  it("отмена парком — возврат всегда, срок не важен", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);
    const result = await autoRefundOnCancellation({
      subjectType: "BOOKING",
      subjectId: "book1",
      trigger: "park_cancellation",
    });
    // платежа нет — но политика дошла до поиска платежа (не отсеклась по сроку)
    expect(prisma.payment.findFirst).toHaveBeenCalled();
    expect(result).toEqual({ refunded: false, reason: "no_payment" });
  });

  it("ошибка возврата не роняет отмену брони", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(paymentRow({ status: "SUCCEEDED" }));
    vi.mocked(prisma.paymentRefund.create).mockResolvedValue({ id: "ref1" } as never);
    vi.mocked(yooRefund).mockRejectedValue(new YooKassaError("internal_server_error", "boom", 500));

    const result = await autoRefundOnCancellation({
      subjectType: "BOOKING",
      subjectId: "book1",
      trigger: "park_cancellation",
    });
    expect(result).toEqual({ refunded: false, reason: "refund_failed" });
  });
});

describe("заказ кафе по оплате (subjectType=ORDER)", () => {
  it("самообслуживание: paidAt + DELIVERED, леджер cafe, канал-событие order.paid", async () => {
    const orderPayment = paymentRow({
      subjectType: "ORDER",
      subjectId: "order1",
      moduleSlug: "cafe",
      description: "Кафе: заказ ORDER1",
    });
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(orderPayment);
    vi.mocked(yooGet).mockResolvedValue(remoteSucceeded as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({
        subjectType: "ORDER",
        subjectId: "order1",
        moduleSlug: "cafe",
        status: "SUCCEEDED",
        paidAt: new Date(),
      })
    );
    const orderRow = {
      id: "order1",
      moduleSlug: "cafe",
      status: "NEW",
      userId: null,
      bookingId: null,
      deliveryTo: null,
      paidAt: null,
      totalAmount: 430,
    };
    vi.mocked(prisma.order.findUnique)
      .mockResolvedValueOnce(orderRow as never) // внутри транзакции
      .mockResolvedValueOnce({
        ...orderRow,
        status: "DELIVERED",
        items: [{ name: "Круассан", quantity: 1 }],
      } as never); // after-hook
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 1 });

    await syncPaymentByProviderId("yk1");

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order1", paidAt: null },
        data: expect.objectContaining({ status: "DELIVERED" }),
      })
    );
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ONLINE_PAYMENT",
          moduleSlug: "cafe",
          bookingId: null,
        }),
      })
    );
    const types = vi.mocked(enqueueNotification).mock.calls.map((c) => c[0].type);
    expect(types).toContain("payment.succeeded");
    expect(types).toContain("order.paid");
  });

  it("отмена платежа: неоплаченный NEW-заказ отменяется", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      paymentRow({ subjectType: "ORDER", subjectId: "order1", moduleSlug: "cafe" })
    );
    vi.mocked(yooGet).mockResolvedValue({
      ...remoteSucceeded,
      status: "canceled",
      paid: false,
      cancellation_details: { party: "yoo_money", reason: "expired_on_confirmation" },
    } as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ subjectType: "ORDER", subjectId: "order1", moduleSlug: "cafe", status: "CANCELED" })
    );
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 1 });

    await syncPaymentByProviderId("yk1");

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order1", status: "NEW", paidAt: null },
      data: { status: "CANCELLED" },
    });
  });
});

describe("getPublicPaymentStatus — payload для страницы ожидания", () => {
  it("ORDER: отдаёт moduleSlug и состав заказа без сумм", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      status: "SUCCEEDED",
      confirmationUrl: null,
      moduleSlug: "cafe",
      subjectType: "ORDER",
      subjectId: "order1xyz",
    } as never);
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: "order1xyz",
      deliveryTo: "204",
      items: [
        { name: "Круассан", quantity: 2 },
        { name: null, quantity: 1 },
      ],
    } as never);

    const status = await getPublicPaymentStatus("pay1");

    expect(status).toEqual({
      id: "pay1",
      status: "SUCCEEDED",
      confirmationUrl: null,
      moduleSlug: "cafe",
      order: {
        orderNumber: "ER1XYZ",
        deliveryTo: "204",
        items: [
          { name: "Круассан", quantity: 2 },
          { name: "Позиция", quantity: 1 },
        ],
      },
    });
  });

  it("BOOKING: order = null, к таблице заказов не обращается", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({
      id: "pay1",
      status: "PENDING",
      confirmationUrl: "https://yookassa.example/pay",
      moduleSlug: "gazebos",
      subjectType: "BOOKING",
      subjectId: "book1",
    } as never);

    const status = await getPublicPaymentStatus("pay1");

    expect(status?.order).toBeNull();
    expect(status?.moduleSlug).toBe("gazebos");
    expect(status?.confirmationUrl).toBe("https://yookassa.example/pay");
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });
});

describe("активация абонемента по оплате", () => {
  it("PENDING_PAYMENT → ACTIVE + стартовая транзакция часов + леджер", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      paymentRow({ subjectType: "SUBSCRIPTION", subjectId: "sub1", moduleSlug: "ps-park" })
    );
    vi.mocked(yooGet).mockResolvedValue(remoteSucceeded as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ subjectType: "SUBSCRIPTION", subjectId: "sub1", moduleSlug: "ps-park", status: "SUCCEEDED" })
    );
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub1",
      userId: "user1",
      moduleSlug: "ps-park",
      status: "PENDING_PAYMENT",
      totalHours: 10,
    } as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null); // нет другого ACTIVE
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 });

    await syncPaymentByProviderId("yk1");

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub1", status: "PENDING_PAYMENT" },
        data: { status: "ACTIVE" },
      })
    );
    expect(prisma.subscriptionTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "MANUAL_TOPUP", reason: "online purchase" }),
      })
    );
    expect(prisma.financialTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "ONLINE_PAYMENT", moduleSlug: "ps-park" }),
      })
    );
  });

  it("при существующем ACTIVE-абонементе активация не выполняется, пишется CRITICAL", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(
      paymentRow({ subjectType: "SUBSCRIPTION", subjectId: "sub1", moduleSlug: "ps-park" })
    );
    vi.mocked(yooGet).mockResolvedValue(remoteSucceeded as never);
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValue(
      paymentRow({ subjectType: "SUBSCRIPTION", subjectId: "sub1", moduleSlug: "ps-park", status: "SUCCEEDED" })
    );
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: "sub1",
      userId: "user1",
      moduleSlug: "ps-park",
      status: "PENDING_PAYMENT",
      totalHours: 10,
    } as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({ id: "sub-other" } as never);

    await syncPaymentByProviderId("yk1");

    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.systemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: "CRITICAL" }),
      })
    );
  });
});

function pay(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "p" + Math.random().toString(36).slice(2, 7),
    provider: "yookassa",
    providerPaymentId: null,
    status: "SUCCEEDED",
    amount: 1000 as never,
    refundedAmount: 0 as never,
    currency: "RUB",
    subjectType: "BOOKING",
    subjectId: "book1",
    moduleSlug: "gazebos",
    userId: null,
    createdById: null,
    confirmationUrl: null,
    description: "d",
    idempotenceKey: "k" + Math.random().toString(36).slice(2, 7),
    paymentMethodType: "bank_card",
    cancellationReason: null,
    customerEmail: null,
    customerPhone: null,
    isTest: true,
    metadata: null,
    paidAt: new Date("2026-07-01T10:00:00.000Z"),
    expiresAt: null,
    createdAt: new Date("2026-07-01T09:00:00.000Z"),
    updatedAt: new Date(),
    ...overrides,
  } as Payment;
}

describe("getBookingPaymentSummaries", () => {
  it("пустой вход — пустая Map без запроса к БД", async () => {
    const res = await getBookingPaymentSummaries([]);
    expect(res.size).toBe(0);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it("один батч-запрос по subjectId IN [...] с subjectType=BOOKING", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      pay({ subjectId: "b1", status: "SUCCEEDED" }),
    ] as never);

    await getBookingPaymentSummaries(["b1", "b2"]);

    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.payment.findMany).mock.calls[0][0];
    expect(arg?.where).toMatchObject({
      subjectType: "BOOKING",
      subjectId: { in: ["b1", "b2"] },
    });
  });

  it("своды статусов: PAID / AWAITING / FAILED / REFUNDED / PARTIALLY_REFUNDED", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      pay({ subjectId: "paid", status: "SUCCEEDED" }),
      pay({ subjectId: "await", status: "PENDING" }),
      pay({ subjectId: "await", status: "WAITING_FOR_CAPTURE" }),
      pay({ subjectId: "fail", status: "CANCELED" }),
      pay({ subjectId: "ref", status: "REFUNDED", refundedAmount: 1000 as never }),
      // частичный: успешный + возврат
      pay({ subjectId: "part", status: "SUCCEEDED" }),
      pay({ subjectId: "part", status: "REFUNDED" }),
      // одиночный PARTIALLY_REFUNDED
      pay({ subjectId: "part2", status: "PARTIALLY_REFUNDED" }),
    ] as never);

    const res = await getBookingPaymentSummaries([
      "paid", "await", "fail", "ref", "part", "part2",
    ]);
    expect(res.get("paid")?.status).toBe("PAID");
    expect(res.get("await")?.status).toBe("AWAITING");
    expect(res.get("fail")?.status).toBe("FAILED");
    expect(res.get("ref")?.status).toBe("REFUNDED");
    expect(res.get("part")?.status).toBe("PARTIALLY_REFUNDED");
    expect(res.get("part2")?.status).toBe("PARTIALLY_REFUNDED");
  });

  it("бронь без платежей отсутствует в Map (NONE трактуется вызывающим)", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as never);
    const res = await getBookingPaymentSummaries(["b1"]);
    expect(res.has("b1")).toBe(false);
  });

  it("PAID: agregat amount = сумма успешных, paymentMethodType из основного платежа", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      pay({ subjectId: "b1", status: "SUCCEEDED", amount: 600 as never, paymentMethodType: "sbp" }),
      pay({ subjectId: "b1", status: "SUCCEEDED", amount: 400 as never, paymentMethodType: "bank_card" }),
    ] as never);
    const res = await getBookingPaymentSummaries(["b1"]);
    expect(res.get("b1")?.status).toBe("PAID");
    expect(res.get("b1")?.amount).toBe("1000.00");
    expect(res.get("b1")?.paymentMethodType).toBe("sbp");
  });
});

describe("getBookingPaymentDetail", () => {
  it("нет платежей → null", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as never);
    expect(await getBookingPaymentDetail("b1")).toBeNull();
  });

  it("возвращает агрегат + список платежей с возвратами", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      { ...pay({ subjectId: "b1", status: "SUCCEEDED", amount: 1000 as never }), refunds: [] },
    ] as never);
    const detail = await getBookingPaymentDetail("b1");
    expect(detail?.status).toBe("PAID");
    expect(detail?.amount).toBe("1000.00");
    expect(detail?.payments).toHaveLength(1);
    const arg = vi.mocked(prisma.payment.findMany).mock.calls[0][0];
    expect(arg?.include).toMatchObject({ refunds: true });
  });
});
