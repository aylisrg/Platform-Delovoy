import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, type Booking, type Payment } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn(), log: { warn: vi.fn(), error: vi.fn(), critical: vi.fn() } }));
vi.mock("@/modules/notifications/queue", () => ({ enqueueNotification: vi.fn() }));
vi.mock("@/modules/notifications/channels/email", () => ({ sendTransactionalEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/google-calendar", () => ({ createCalendarEvent: vi.fn(), deleteCalendarEvent: vi.fn() }));
vi.mock("@/modules/clients/service", () => ({ upsertClientByPhone: vi.fn() }));
vi.mock("@/modules/inventory/service", () => ({
  validateAndSnapshotItems: vi.fn(), saleBookingItems: vi.fn(), returnBookingItems: vi.fn(),
  InventoryError: class InventoryError extends Error {},
}));
vi.mock("@/lib/metrika-server", () => ({ trackServerGoal: vi.fn() }));
vi.mock("@/modules/ps-park/checkout-analytics", () => ({ recordPSParkCheckoutAnalytics: vi.fn() }));
vi.mock("@/modules/analytics/product-events", () => ({
  recordPaidStep: vi.fn(), recordFunnelStep: vi.fn(), deriveSessionKeyFromHeaders: vi.fn(),
}));
vi.mock("@/lib/yookassa/client", async (original) => ({
  ...await original<typeof import("@/lib/yookassa/client")>(),
  isYooKassaConfigured: vi.fn().mockReturnValue(true), createPayment: vi.fn(), getPayment: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  payment: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() }, resource: { findFirst: vi.fn(), findUnique: vi.fn() }, module: { findUnique: vi.fn() },
  offerVersion: { findFirst: vi.fn() }, financialTransaction: { create: vi.fn() }, auditLog: { create: vi.fn() },
  systemEvent: { create: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn(),
} }));

import { prisma } from "@/lib/db";
import { createPayment, getPayment, isYooKassaConfigured, YooKassaError } from "@/lib/yookassa/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import { saleBookingItems, returnBookingItems, validateAndSnapshotItems } from "@/modules/inventory/service";
import { log } from "@/lib/logger";
import { addItemsToBooking, cancelBooking, getBookingBill, updateBookingStatus } from "../service";
import { POST as checkout } from "@/app/api/ps-park/book/route";
import { POST as webhook } from "@/app/api/payments/yookassa/webhook/[secret]/route";

const input = {
  requestId: "dd42730b-bd56-4c21-8d84-2375ca8eace1", resourceId: "table-1",
  date: "2026-11-01", startTime: "10:00", endTime: "12:00",
  guestName: "Тестовый гость", guestPhone: "+79991234567", email: "guest@example.test",
  acceptOffer: true, offerVersionSlug: "test-v1",
};
let bookings: Map<string, Booking>;
let payments: Map<string, Payment>;
const booking = () => [...bookings.values()][0];
const payment = () => [...payments.values()][0];
const paidEvent = { type: "notification", event: "payment.succeeded", object: { id: "provider-1", amount: { value: "1.00" }, metadata: undefined as { paymentId: string } | undefined } };

function post(body: unknown = input) {
  return checkout(new NextRequest("http://localhost/api/ps-park/book", {
    method: "POST", body: JSON.stringify(body), headers: { "user-agent": "checkout-test" },
  }));
}
function notify(event = paidEvent) {
  return webhook(new NextRequest("http://localhost/api/payments/yookassa/webhook/test-only", {
    method: "POST", body: JSON.stringify(event),
  }), { params: Promise.resolve({ secret: "test-only" }) });
}
function remote(status: "pending" | "succeeded" | "canceled" = "succeeded") {
  const p = payment();
  return {
    id: "provider-1", status, paid: status === "succeeded", amount: { value: "1000.00", currency: "RUB" },
    metadata: { paymentId: p.id, subjectType: p.subjectType, subjectId: p.subjectId },
    created_at: "2026-10-27T06:00:00Z", confirmation: { type: "redirect", confirmation_url: "https://example.test/pay" },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T06:00:00Z"));
  vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "test-only");
  vi.stubEnv("YOOKASSA_RECEIPTS_ENABLED", "false");
  bookings = new Map(); payments = new Map();
  vi.mocked(isYooKassaConfigured).mockReturnValue(true);
  vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: { onlineBookingEnabled: true } } as never);
  vi.mocked(prisma.offerVersion.findFirst).mockResolvedValue({
    id: "test-offer", documentKey: "ps-park-offer", slug: "test-v1", contentHash: "fixture-only", isCurrent: true,
  } as never);
  vi.mocked(prisma.resource.findFirst).mockResolvedValue({
    id: "table-1", moduleSlug: "ps-park", name: "Стол 1", capacity: 4, pricePerHour: new Prisma.Decimal(500),
  } as never);
  vi.mocked(prisma.resource.findUnique).mockResolvedValue({ name: "Стол 1", googleCalendarId: null } as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
  vi.mocked(prisma.booking.findFirst).mockImplementation((async ({ where }: { where: { id?: string } }) => {
    if (where.id) return bookings.get(where.id) ?? null;
    return [...bookings.values()].find((b) => ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(b.status)) ?? null;
  }) as never);
  vi.mocked(prisma.booking.findUniqueOrThrow).mockImplementation((async ({ where }: { where: { id: string } }) => bookings.get(where.id)) as never);
  vi.mocked(prisma.booking.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) => bookings.get(where.id) ?? null) as never);
  vi.mocked(prisma.booking.create).mockImplementation((async ({ data }: { data: Booking }) => {
    if (bookings.has(data.id)) throw Object.assign(new Error("unique"), { code: "P2002" });
    const row = { ...data, deletedAt: null, createdAt: new Date() };
    bookings.set(row.id, row); return row;
  }) as never);
  vi.mocked(prisma.booking.update).mockImplementation((async ({ where, data }: { where: { id: string }; data: Partial<Booking> }) => {
    const row = { ...bookings.get(where.id)!, ...data }; bookings.set(row.id, row); return row;
  }) as never);
  vi.mocked(prisma.booking.updateMany).mockImplementation((async ({ where, data }: { where: { id: string; status: string | { in: string[] } }; data: Partial<Booking> }) => {
    const row = bookings.get(where.id);
    const statuses = typeof where.status === "string" ? [where.status] : where.status.in;
    if (!row || !statuses.includes(row.status)) return { count: 0 };
    bookings.set(row.id, { ...row, ...data }); return { count: 1 };
  }) as never);
  const findPayment = ({ where }: { where: { id?: string; idempotenceKey?: string; providerPaymentId?: string } }) =>
    [...payments.values()].find((p) => Object.entries(where).every(([key, value]) => p[key as keyof Payment] === value)) ?? null;
  vi.mocked(prisma.payment.findUnique).mockImplementation((async (args: Parameters<typeof findPayment>[0]) => findPayment(args)) as never);
  vi.mocked(prisma.payment.findUniqueOrThrow).mockImplementation((async (args: Parameters<typeof findPayment>[0]) => findPayment(args)) as never);
  vi.mocked(prisma.payment.create).mockImplementation((async ({ data }: { data: Payment }) => {
    if ([...payments.values()].some((p) => p.idempotenceKey === data.idempotenceKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
    const row = { ...data, currency: "RUB", amount: new Prisma.Decimal(data.amount), status: "PENDING", createdAt: new Date(), providerPaymentId: null } as Payment;
    payments.set(row.id, row); return row;
  }) as never);
  vi.mocked(prisma.payment.update).mockImplementation((async ({ where, data }: { where: { id: string }; data: Partial<Payment> }) => {
    const row = { ...payments.get(where.id)!, ...data }; payments.set(row.id, row); return row;
  }) as never);
  vi.mocked(prisma.payment.updateMany).mockImplementation((async ({ where, data }: { where: { id: string; status?: { in: string[] } | string; providerPaymentId?: string | null }; data: Partial<Payment> }) => {
    const row = payments.get(where.id);
    const statuses = typeof where.status === "string" ? [where.status] : where.status?.in;
    if (!row || (statuses && !statuses.includes(row.status)) || ("providerPaymentId" in where && row.providerPaymentId !== where.providerPaymentId)) return { count: 0 };
    payments.set(row.id, { ...row, ...data }); return { count: 1 };
  }) as never);
  vi.mocked(createPayment).mockImplementation(async (request) => ({ ...remote("pending"), amount: request.amount, metadata: request.metadata }));
  vi.mocked(getPayment).mockImplementation(async () => remote());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Play Park: HTTP checkout → общий payments → webhook (БД и провайдер замокированы)", () => {
  it("восстанавливает confirmationUrl через GET после раннего webhook и обрыва ответа create", async () => {
    vi.mocked(getPayment).mockImplementation(async () => remote("pending"));
    vi.mocked(createPayment).mockImplementationOnce(async (request) => {
      const early = { ...paidEvent, object: { ...paidEvent.object, metadata: { paymentId: String(request.metadata?.paymentId) } } };
      expect((await notify(early)).status).toBe(200);
      throw new Error("create response connection lost");
    });
    expect((await (await post()).json()).error.code).toBe("PAYMENT_CREATE_PENDING");
    expect(payment().providerPaymentId).toBe("provider-1");
    expect(payment().confirmationUrl).toBeFalsy();
    const response = await post();
    expect(response.status).toBe(201);
    expect((await response.json()).data.payment.confirmationUrl).toBe("https://example.test/pay");
    expect(payment().confirmationUrl).toBe("https://example.test/pay");
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(getPayment).toHaveBeenCalledTimes(2);
    expect(bookings.size).toBe(1); expect(payments.size).toBe(1);
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  it("webhook опередил ответ создания: привязывает проверенный provider id и не теряет оплату", async () => {
    vi.mocked(createPayment).mockImplementationOnce(async (request) => {
      expect(payment().providerPaymentId).toBeNull();
      const early = { ...paidEvent, object: { ...paidEvent.object, metadata: { paymentId: String(request.metadata?.paymentId) } } };
      expect((await notify(early)).status).toBe(200);
      expect(booking().status).toBe("CONFIRMED");
      // HTTP-ответ create был сформирован раньше события и ещё содержит pending.
      return { ...remote("pending"), metadata: request.metadata };
    });
    const response = await post();
    expect(response.status).toBe(201);
    expect((await response.json()).data.payment.confirmationUrl).toBe(`/payments/${payment().id}`);
    await notify();
    expect(payment().status).toBe("SUCCEEDED");
    expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
  });

  it.each(["succeeded", "canceled"] as const)("восстановление ссылки учитывает актуальный статус %s без повторного создания", async (status) => {
    await post();
    payments.set(payment().id, { ...payment(), confirmationUrl: null });
    vi.mocked(getPayment).mockImplementation(async () => remote(status));
    const response = await post();
    if (status === "succeeded") {
      expect(response.status).toBe(201);
      expect((await response.json()).data.payment.confirmationUrl).toBe(`/payments/${payment().id}`);
      expect(booking().status).toBe("CONFIRMED");
      await post(); await notify();
      expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
    } else {
      expect((await response.json()).error.code).toBe("PAYMENT_CANCELED");
      expect(booking().status).toBe("CANCELLED");
      expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
    }
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it("восстановление ссылки отклоняет несовпадающую сумму из API", async () => {
    await post();
    payments.set(payment().id, { ...payment(), confirmationUrl: null });
    vi.mocked(getPayment).mockResolvedValue({ ...remote("pending"), amount: { value: "1.00", currency: "RUB" } });
    expect((await (await post()).json()).error.code).toBe("PAYMENT_VERIFICATION_FAILED");
    expect(payment().confirmationUrl).toBeNull();
    expect(booking().status).toBe("PENDING");
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  it("ранний webhook не связывает paymentId из тела без подтверждения API", async () => {
    vi.mocked(createPayment).mockImplementationOnce(async (request) => {
      vi.mocked(getPayment).mockResolvedValue({ ...remote(), metadata: { ...request.metadata, paymentId: "another-payment" } });
      expect((await notify({ ...paidEvent, object: { ...paidEvent.object, metadata: { paymentId: payment().id } } })).status).toBe(500);
      expect(payment().providerPaymentId).toBeNull();
      return { ...remote("pending"), metadata: request.metadata };
    });
    expect((await post()).status).toBe(201);
    expect(booking().status).toBe("PENDING");
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  it("повтор cancel после success не отменяет бронь и не меняет леджер", async () => {
    await post(); await notify();
    vi.mocked(getPayment).mockImplementation(async () => remote("canceled"));
    await notify({ ...paidEvent, event: "payment.canceled" });
    await notify({ ...paidEvent, event: "payment.canceled" });
    expect(booking().status).toBe("CONFIRMED");
    expect(payment().status).toBe("SUCCEEDED");
    expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
  });

  it("не даёт менеджеру подтвердить новую онлайн-бронь вручную", async () => {
    await post();
    await expect(updateBookingStatus(booking().id, "CONFIRMED", "manager-1")).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(booking().status).toBe("PENDING");
  });

  it("после смены тарифа завершает оплаченный интервал по snapshot без двойной выручки", async () => {
    await post(); await notify();
    vi.mocked(prisma.resource.findUnique).mockResolvedValue({ name: "Стол 1", pricePerHour: new Prisma.Decimal(9000) } as never);
    vi.setSystemTime(new Date("2026-11-01T09:00:00Z"));
    const bill = await getBookingBill(booking().id);
    expect(bill.totalBill).toBe(1000);
    expect(bill.onlinePaidAmount).toBe(1000);
    await updateBookingStatus(booking().id, "COMPLETED", "manager-1", undefined, 0, 0);
    expect(booking().status).toBe("COMPLETED");
    const ledger = vi.mocked(prisma.financialTransaction.create).mock.calls;
    expect(ledger).toHaveLength(2); // ONLINE_PAYMENT 1000 + закрытие кассы 0
    expect(ledger.map(([args]) => Number(args.data.totalAmount))).toEqual([1000, 0]);
  });

  it("ошибка настройки чека не оставляет неоплаченную бронь без Payment", async () => {
    vi.stubEnv("YOOKASSA_RECEIPTS_ENABLED", "true");
    vi.stubEnv("YOOKASSA_VAT_CODE", "invalid");
    expect((await post()).status).toBe(400);
    expect(bookings.size).toBe(0); expect(payments.size).toBe(0);
  });

  it("гость сразу получает оплату, только проверенный webhook подтверждает бронь", async () => {
    const response = await post({ ...input, amount: 1, totalPrice: 1, status: "CONFIRMED" });
    expect(response.status).toBe(201);
    expect((await response.json()).data.payment.confirmationUrl).toBe("https://example.test/pay");
    expect(booking().status).toBe("PENDING");
    expect(booking().acceptedOfferAt).toBeInstanceOf(Date);
    expect(Number(payment().amount)).toBe(1000);
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: { value: "1000.00", currency: "RUB" } }), payment().idempotenceKey);
    expect((payment().metadata as Record<string, unknown>).receiptItems).toEqual([expect.objectContaining({ paymentMode: "full_prepayment" })]);
    expect((await notify()).status).toBe(200);
    expect(booking().status).toBe("CONFIRMED");
    expect((booking().metadata as Record<string, unknown>).onlinePaidAmount).toBe("1000.00");
    expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "booking.confirmed", moduleSlug: "ps-park" }));
  });

  it("параллельный двойной клик и повтор webhook не дублируют бронь, платёж и леджер", async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(bookings.size).toBe(1); expect(payments.size).toBe(1);
    expect(new Set(vi.mocked(createPayment).mock.calls.map((c) => c[1])).size).toBe(1);
    await notify(); await notify();
    expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
    expect(booking().status).toBe("CONFIRMED");
  });

  it("после timeout повторяет сохранённый запрос с тем же ключом", async () => {
    vi.mocked(createPayment).mockRejectedValueOnce(new Error("timeout"));
    expect((await (await post()).json()).error.code).toBe("PAYMENT_CREATE_PENDING");
    const first = vi.mocked(createPayment).mock.calls[0];
    expect(payment().status).toBe("PENDING");
    expect((await post()).status).toBe(201);
    expect(vi.mocked(createPayment).mock.calls[1]).toEqual(first);
    expect(payments.size).toBe(1); expect(bookings.size).toBe(1);
  });

  it("после 24 часов неизвестного исхода не создаёт второй платёж", async () => {
    vi.mocked(createPayment).mockRejectedValueOnce(new Error("timeout"));
    await post();
    vi.setSystemTime(new Date("2026-10-28T06:01:00Z"));
    expect((await (await post()).json()).error.code).toBe("PAYMENT_REVIEW_REQUIRED");
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it("сохраняет цену брони при изменении тарифа перед повторной оплатой", async () => {
    await post();
    vi.mocked(prisma.resource.findFirst).mockResolvedValue({ pricePerHour: new Prisma.Decimal(9999) } as never);
    expect((await post()).status).toBe(201);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(Number(payment().amount)).toBe(1000);
  });

  it("тот же requestId с другими данными не выдаёт ссылку и не меняет сумму", async () => {
    await post();
    expect((await (await post({ ...input, endTime: "13:00" })).json()).error.code).toBe("CHECKOUT_CHANGED");
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it("отказ провайдера освобождает слот, новая попытка оформляется отдельно", async () => {
    await post();
    vi.mocked(getPayment).mockImplementation(async () => remote("canceled"));
    await notify({ ...paidEvent, event: "payment.canceled" });
    expect(booking().status).toBe("CANCELLED");
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
    expect((await (await post()).json()).error.code).toBe("PAYMENT_CANCELED");
    expect((await post({ ...input, requestId: "6025eaef-dd7c-458a-9126-067c5e26bf49" })).status).toBe(201);
    expect(bookings.size).toBe(2);
  });

  it("определённый отказ создания платежа тоже отменяет неоплаченную бронь", async () => {
    vi.mocked(createPayment).mockRejectedValueOnce(new YooKassaError("invalid_request", "invalid", 400));
    expect((await (await post()).json()).error.code).toBe("PAYMENT_CANCELED");
    expect(booking().status).toBe("CANCELLED");
  });

  it("поздний успешный webhook учитывает деньги, не воскрешает отменённую бронь", async () => {
    await post();
    vi.mocked(getPayment).mockImplementation(async () => remote("canceled"));
    await notify({ ...paidEvent, event: "payment.canceled" });
    vi.mocked(getPayment).mockImplementation(async () => remote());
    await notify(); await notify();
    expect(payment().status).toBe("SUCCEEDED");
    expect(booking().status).toBe("CANCELLED");
    expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("payments", expect.stringContaining("требуется сверка и перенос"), expect.anything());
    expect(enqueueNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: "booking.confirmed" }));
  });

  it("читает бронь после блокировки: конкурентная отмена не теряет принятые деньги", async () => {
    await post();
    vi.mocked(prisma.$executeRaw).mockImplementationOnce((async () => {
      // Cancellation committed while success was waiting for the row lock.
      const b = booking();
      bookings.set(b.id, { ...b, status: "CANCELLED", metadata: { ...(b.metadata as object), managerNote: "перенести" } });
      return 1;
    }) as never);
    await notify(); await notify();
    expect(payment().status).toBe("SUCCEEDED");
    expect(booking().status).toBe("CANCELLED");
    expect(booking().metadata).toMatchObject({ onlinePaidAmount: "1000.00", managerNote: "перенести" });
    expect(prisma.financialTransaction.create).toHaveBeenCalledTimes(1);
    expect(saleBookingItems).not.toHaveBeenCalled();
  });

  it.each(["amount", "currency", "subject", "paid"])("re-fetch с несовпадением %s не подтверждает бронь", async (kind) => {
    await post();
    const bad = remote();
    if (kind === "amount") bad.amount.value = "1.00";
    if (kind === "currency") bad.amount.currency = "USD";
    if (kind === "subject") bad.metadata.subjectId = "another-booking";
    if (kind === "paid") bad.paid = false;
    vi.mocked(getPayment).mockResolvedValue(bad);
    expect((await notify()).status).toBe(500);
    expect(booking().status).toBe("PENDING");
    expect(prisma.financialTransaction.create).not.toHaveBeenCalled();
  });

  it("событие succeeded при pending у провайдера ничего не подтверждает", async () => {
    await post();
    vi.mocked(getPayment).mockImplementation(async () => remote("pending"));
    await notify();
    expect(booking().status).toBe("PENDING");
  });

  it.each(["disabled", "offer", "provider", "consent"])("закрыт до выполнения условия %s", async (condition) => {
    if (condition === "disabled") vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);
    if (condition === "offer") vi.mocked(prisma.offerVersion.findFirst).mockResolvedValue(null);
    if (condition === "provider") vi.mocked(isYooKassaConfigured).mockReturnValue(false);
    expect((await post(condition === "consent" ? { ...input, acceptOffer: false } : input)).status).toBeGreaterThanOrEqual(400);
    expect(bookings.size).toBe(0); expect(createPayment).not.toHaveBeenCalled();
  });

  it("чужой/неактивный ресурс не бронируется", async () => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(null);
    expect((await (await post()).json()).error.code).toBe("RESOURCE_NOT_FOUND");
    expect(prisma.resource.findFirst).toHaveBeenCalledWith({ where: { id: "table-1", moduleSlug: "ps-park", isActive: true } });
    expect(createPayment).not.toHaveBeenCalled();
  });

  it.each([null, 0])("ресурс без платного тарифа (%s) не создаёт ручную заявку", async (pricePerHour) => {
    vi.mocked(prisma.resource.findFirst).mockResolvedValue({ pricePerHour } as never);
    expect((await (await post()).json()).error.code).toBe("PRICE_NOT_CONFIGURED");
    expect(bookings.size).toBe(0);
  });

  it("фиксирует оплаченные длительность и товары и не даёт менять PENDING snapshot", async () => {
    await post();
    expect(booking().metadata).toMatchObject({ reservationDurationMinutes: 120, reservationItemsTotal: "0.00" });
    await expect(addItemsToBooking(booking().id, "manager", [{ skuId: "snack", quantity: 1 }])).rejects.toMatchObject({ code: "PAYMENT_PENDING" });
    expect(validateAndSnapshotItems).not.toHaveBeenCalled();
    await notify();
    expect(booking().metadata).toMatchObject({ onlinePaidAmount: "1000.00" });
  });

  it("возвращает товары при отмене оплаченной NO_SHOW перед будущим переносом", async () => {
    await post(); await notify();
    const b = booking();
    bookings.set(b.id, { ...b, status: "NO_SHOW", metadata: { ...(b.metadata as object), items: [{ skuId: "snack", quantity: 1 }] } });
    await updateBookingStatus(b.id, "CANCELLED", "manager");
    expect(booking().status).toBe("CANCELLED");
    expect(returnBookingItems).toHaveBeenCalledTimes(1);
    await expect(updateBookingStatus(b.id, "CANCELLED", "manager")).rejects.toBeTruthy();
    expect(returnBookingItems).toHaveBeenCalledTimes(1);
  });

  it("не применяет старый штраф 50% к онлайн-предоплате: предлагает перенос", async () => {
    await post(); await notify();
    const b = booking();
    bookings.set(b.id, { ...b, userId: "guest-user" });
    await expect(cancelBooking(b.id, "guest-user", "изменились планы", true)).rejects.toMatchObject({
      code: "RESCHEDULE_REQUIRED",
      message: expect.stringContaining("+7 (985) 244-46-24"),
    });
    expect(booking().status).toBe("CONFIRMED");
    expect(booking().metadata).not.toHaveProperty("cancelPenalty");
  });

  it("не списывает инвентарь при повторной доставке", async () => {
    await post();
    const b = booking();
    bookings.set(b.id, { ...b, metadata: { ...(b.metadata as object), items: [{ skuId: "sku-1", quantity: 1 }] } });
    await notify(); await notify();
    expect(saleBookingItems).toHaveBeenCalledTimes(1);
  });
});
