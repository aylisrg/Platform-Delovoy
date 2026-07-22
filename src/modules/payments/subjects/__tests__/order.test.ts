import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Payment, Prisma } from "@prisma/client";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    order: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/modules/notifications/queue";
import {
  onOrderPaymentSucceeded,
  onOrderPaymentCanceled,
  afterOrderPaymentSucceeded,
} from "../order";

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    subjectType: "ORDER",
    subjectId: "order1xyz",
    moduleSlug: "cafe",
    amount: 430 as never,
    userId: null,
    provider: "yookassa",
    providerPaymentId: "yk-1",
    paidAt: new Date("2026-07-22T10:00:00.000Z"),
    description: "Кафе: заказ R1XYZ",
    ...overrides,
  } as Payment;
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order1xyz",
    moduleSlug: "cafe",
    status: "NEW",
    userId: null,
    bookingId: null,
    deliveryTo: null,
    totalAmount: 430,
    paidAt: null,
    ...overrides,
  };
}

function makeTx() {
  return {
    order: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    financialTransaction: { create: vi.fn() },
    systemEvent: { create: vi.fn() },
  } as unknown as Prisma.TransactionClient & {
    order: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    financialTransaction: { create: ReturnType<typeof vi.fn> };
    systemEvent: { create: ReturnType<typeof vi.fn> };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onOrderPaymentSucceeded", () => {
  it("самообслуживание (без deliveryTo, NEW): paidAt + сразу DELIVERED", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(order());

    await onOrderPaymentSucceeded(tx, payment());

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order1xyz", paidAt: null },
      data: expect.objectContaining({ status: "DELIVERED", paidAt: expect.any(Date) }),
    });
    expect(tx.financialTransaction.create).toHaveBeenCalledTimes(1);
  });

  it("с deliveryTo: paidAt ставится, статус NEW не меняется (кухонный цикл)", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(order({ deliveryTo: "204" }));

    await onOrderPaymentSucceeded(tx, payment());

    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data.paidAt).toBeInstanceOf(Date);
    expect(data.status).toBeUndefined();
  });

  it("взятый в работу заказ (PREPARING): статус не трогаем, только paidAt", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(order({ status: "PREPARING" }));

    await onOrderPaymentSucceeded(tx, payment());

    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
  });

  it("леджер: ONLINE_PAYMENT с metadata.orderId и bookingId=null", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(order());

    await onOrderPaymentSucceeded(tx, payment());

    const ledger = tx.financialTransaction.create.mock.calls[0][0].data;
    expect(ledger.type).toBe("ONLINE_PAYMENT");
    expect(ledger.moduleSlug).toBe("cafe");
    expect(ledger.bookingId).toBeNull();
    expect(ledger.totalAmount).toBe(430);
    expect(ledger.metadata).toMatchObject({
      orderId: "order1xyz",
      paymentId: "pay1",
      providerPaymentId: "yk-1",
    });
  });

  it("заказ, привязанный к брони: bookingId уходит в леджер", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(order({ bookingId: "book9" }));

    await onOrderPaymentSucceeded(tx, payment());

    expect(tx.financialTransaction.create.mock.calls[0][0].data.bookingId).toBe("book9");
  });

  it("повторный вебхук (paidAt уже стоит, count 0): леджер не задваивается", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(order({ paidAt: new Date() }));
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await onOrderPaymentSucceeded(tx, payment());

    expect(tx.financialTransaction.create).not.toHaveBeenCalled();
  });

  it("заказ не найден → systemEvent ERROR, без падения", async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(null);

    await onOrderPaymentSucceeded(tx, payment());

    expect(tx.systemEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ level: "ERROR", source: "payments" }),
    });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.financialTransaction.create).not.toHaveBeenCalled();
  });
});

describe("onOrderPaymentCanceled", () => {
  it("отменяет только NEW и неоплаченный заказ (CAS-условие)", async () => {
    const tx = makeTx();

    await onOrderPaymentCanceled(tx, payment());

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order1xyz", status: "NEW", paidAt: null },
      data: { status: "CANCELLED" },
    });
  });
});

describe("afterOrderPaymentSucceeded", () => {
  it("шлёт order.paid с номером, суммой и составом", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(
      order({
        deliveryTo: null,
        items: [
          { name: "Круассан", quantity: 2 },
          { name: "Американо", quantity: 1 },
        ],
      }) as never
    );

    await afterOrderPaymentSucceeded(payment());

    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    const event = vi.mocked(enqueueNotification).mock.calls[0][0];
    expect(event.type).toBe("order.paid");
    expect(event.moduleSlug).toBe("cafe");
    expect(event.entityId).toBe("order1xyz");
    expect(event.data.orderNumber).toBe("ER1XYZ");
    expect(event.data.itemsSummary).toBe("Круассан ×2, Американо ×1");
    expect(String(event.data.amount)).toContain("430");
  });

  it("позиция без снапшота имени → «Позиция»", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(
      order({ items: [{ name: null, quantity: 3 }] }) as never
    );

    await afterOrderPaymentSucceeded(payment());

    expect(vi.mocked(enqueueNotification).mock.calls[0][0].data.itemsSummary).toBe(
      "Позиция ×3"
    );
  });

  it("заказ не найден → ничего не шлёт", async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null as never);
    await afterOrderPaymentSucceeded(payment());
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});
