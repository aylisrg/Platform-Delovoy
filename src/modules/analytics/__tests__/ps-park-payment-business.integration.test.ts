/** Service-boundary regression: actual checkout/payment/settlement/funnel/report.
 * DB and external transports are fixtures; no Prisma engine or external network.
 * This deliberately does not claim transaction/concurrency coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, type Booking, type Payment, type FinancialTransaction, type ProductEvent } from "@prisma/client";

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
vi.mock("@/lib/redis", () => ({ redis: { set: vi.fn() }, redisAvailable: false }));
vi.mock("../service", () => ({ getCampaigns: vi.fn() }));
vi.mock("../metrika-client", () => ({ MetrikaClient: vi.fn() }));
vi.mock("@/lib/yookassa/client", async (original) => ({
  ...await original<typeof import("@/lib/yookassa/client")>(),
  isYooKassaConfigured: vi.fn().mockReturnValue(true), createPayment: vi.fn(), getPayment: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  payment: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() }, resource: { findFirst: vi.fn(), findUnique: vi.fn() }, module: { findUnique: vi.fn() },
  offerVersion: { findFirst: vi.fn() }, financialTransaction: { create: vi.fn(), findMany: vi.fn() },
  productEvent: { create: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() }, order: { findMany: vi.fn() }, paymentRefund: { findMany: vi.fn() }, auditLog: { create: vi.fn() },
  systemEvent: { create: vi.fn() }, $executeRaw: vi.fn(), $queryRaw: vi.fn(), $transaction: vi.fn(),
} }));

import { prisma } from "@/lib/db";
import { createPayment, getPayment, isYooKassaConfigured } from "@/lib/yookassa/client";
import { extendBooking, updateBookingStatus } from "@/modules/ps-park/service";
import { getBusinessReport } from "../business-service";
import { recordPSParkCheckoutAnalytics } from "@/modules/ps-park/checkout-analytics";
import { recordPaidStep } from "../product-events";
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

let ledger: FinancialTransaction[];
let events: ProductEvent[];
const reportNow = new Date("2026-11-02T06:00:00Z");
const drainEvents = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  ledger = []; events = [];
  vi.stubEnv("PRODUCT_EVENT_SALT", "integration-fixture-only");
  vi.mocked(prisma.$transaction).mockImplementation((async (operation: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
    Array.isArray(operation) ? Promise.all(operation) : operation(prisma)) as never);
  vi.mocked(prisma.financialTransaction.create).mockImplementation((async ({ data }: { data: FinancialTransaction }) => {
    const row = { ...data, id: `ledger-${ledger.length}`, createdAt: new Date() };
    ledger.push(row); return row;
  }) as never);
  vi.mocked(prisma.financialTransaction.findMany).mockImplementation((async ({ where }: { where: { createdAt?: { gte: Date; lt: Date } } }) => {
    if (where.createdAt) return ledger.filter(row => row.createdAt >= where.createdAt!.gte && row.createdAt < where.createdAt!.lt);
    return ledger.filter(row => (row.metadata as Record<string, unknown>)?.paymentId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }) as never);
  vi.mocked(prisma.productEvent.create).mockImplementation((async ({ data }: { data: ProductEvent }) => {
    const row = { ...data, id: `event-${events.length}`, createdAt: new Date() };
    events.push(row); return row;
  }) as never);
  vi.mocked(prisma.productEvent.upsert).mockImplementation((async ({ where, create }: { where: { id: string }; create: ProductEvent }) => {
    const existing = events.find(row => row.id === where.id);
    if (existing) return existing;
    const row = { ...create, createdAt: new Date() };
    events.push(row); return row;
  }) as never);
  vi.mocked(prisma.productEvent.findFirst).mockImplementation((async ({ where }: { where: { entityId: string; funnel: string; step: string; createdAt: { gte: Date } } }) =>
    [...events].reverse().find(row => row.entityId === where.entityId && row.funnel === where.funnel && row.step === where.step && row.createdAt >= where.createdAt.gte) ?? null) as never);
  vi.mocked(prisma.productEvent.findMany).mockImplementation((async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) =>
    events.filter(row => row.createdAt >= where.createdAt.gte && row.createdAt < where.createdAt.lt)) as never);
  // Mirrors the SQL COUNT(DISTINCT "sessionKey") for visitor-day funnel steps.
  vi.mocked(prisma.$queryRaw).mockImplementation((async (_sql: TemplateStringsArray, ...values: unknown[]) => {
    const [start, end] = values.filter((value): value is Date => value instanceof Date);
    const counts = new Map<string, Set<string>>();
    for (const row of events) {
      if (row.createdAt < start || row.createdAt >= end || !row.sessionKey || !["view", "form_started", "cart_item_added", "slot_selected"].includes(row.step)) continue;
      const key = `${row.funnel}|${row.step === "view" ? "view" : "started"}`;
      counts.set(key, (counts.get(key) ?? new Set()).add(row.sessionKey));
    }
    return [...counts].map(([key, sessions]) => ({ funnel: key.split("|")[0], stage: key.split("|")[1], visitors: sessions.size }));
  }) as never);
  vi.mocked(prisma.payment.findMany).mockImplementation((async () => [...payments.values()]) as never);
  vi.mocked(prisma.payment.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) =>
    [...payments.values()].find(row => Object.entries(where).every(([key, value]) => row[key as keyof Payment] === value)) ?? null) as never);
  vi.mocked(prisma.booking.findMany).mockImplementation((async ({ where }: { where: { startTime: { gte: Date; lt: Date } } }) =>
    [...bookings.values()].filter(row => row.startTime >= where.startTime.gte && row.startTime < where.startTime.lt)) as never);
  vi.mocked(prisma.order.findMany).mockResolvedValue([]);
  vi.mocked(prisma.paymentRefund.findMany).mockResolvedValue([]);
});

async function report() {
  await drainEvents();
  return getBusinessReport("7d", reportNow, false);
}
const money = (r: Awaited<ReturnType<typeof report>>) => r.lines.find(line => line.slug === "ps-park")!;
const funnel = (r: Awaited<ReturnType<typeof report>>) => r.funnel.find(line => line.slug === "ps-park")!;

describe("Play Park payment → session settlement → business report", () => {
  it("counts prepayment once after zero-cash settlement and webhook replay; paid funnel stays one", async () => {
    expect((await post()).status).toBe(201);
    expect((await notify()).status).toBe(200);
    expect((await notify()).status).toBe(200);
    vi.setSystemTime(new Date("2026-11-01T09:00:00Z"));
    await updateBookingStatus(booking().id, "COMPLETED", "manager", undefined, 0, 0);
    const result = await report();
    expect(ledger.map(row => [row.type, Number(row.totalAmount)])).toEqual([["ONLINE_PAYMENT", 1000], ["SESSION_PAYMENT", 0]]);
    expect(money(result)).toMatchObject({ receipts: 1000, net: 1000, online: 1000, cash: 0, card: 0, completed: 1 });
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 1 });
    expect(result.quality.unknownPaymentRows).toBe(0);
    expect(result.quality.warnings.join(" ")).not.toContain("без кассовой записи");
    expect(result.series.rows.reduce((sum, day) => sum + day.net, 0)).toBe(1000);
  });

  it("adds only cash/card remainder for an extended prepaid session", async () => {
    await post(); await notify();
    await extendBooking(booking().id, "manager");
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    await updateBookingStatus(booking().id, "COMPLETED", "manager", undefined, 200, 300);
    const result = await report();
    expect(ledger.map(row => [row.type, Number(row.totalAmount)])).toEqual([["ONLINE_PAYMENT", 1000], ["SESSION_PAYMENT", 500]]);
    expect(money(result)).toMatchObject({ receipts: 1500, net: 1500, online: 1000, cash: 200, card: 300 });
    expect(funnel(result).paid).toBe(1);
  });

  it("excludes a provider test payment from money and paid conversion after settlement", async () => {
    await post();
    vi.mocked(getPayment).mockImplementation(async () => ({ ...remote(), test: true }));
    await notify();
    vi.setSystemTime(new Date("2026-11-01T09:00:00Z"));
    await updateBookingStatus(booking().id, "COMPLETED", "manager", undefined, 0, 0);
    const result = await report();
    expect(payment().isTest).toBe(true);
    expect(events.some(row => row.step === "paid")).toBe(true);
    expect(money(result)).toMatchObject({ receipts: 0, net: 0, online: 0 });
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 0 });
    expect(result.quality.excludedLedgerRows).toBe(1);
  });

  it("canceled payment contributes no money or paid conversion", async () => {
    await post();
    vi.mocked(getPayment).mockImplementation(async () => remote("canceled"));
    await notify({ ...paidEvent, event: "payment.canceled" });
    const result = await report();
    expect(ledger).toHaveLength(0);
    expect(money(result)).toMatchObject({ receipts: 0, net: 0, cancelled: 1 });
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 0 });
  });

  it("late confirmed money is counted once while the canceled slot stays canceled", async () => {
    await post();
    vi.mocked(getPayment).mockImplementation(async () => remote("canceled"));
    await notify({ ...paidEvent, event: "payment.canceled" });
    vi.mocked(getPayment).mockImplementation(async () => remote());
    await notify(); await notify();
    const result = await report();
    expect(booking().status).toBe("CANCELLED");
    expect(ledger).toHaveLength(1);
    expect(money(result)).toMatchObject({ receipts: 1000, net: 1000, online: 1000, refunds: 0, cancelled: 1 });
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 1 });
  });

  it("does not lose paid conversion when success webhook arrives before checkout response", async () => {
    vi.mocked(createPayment).mockImplementationOnce(async (request) => {
      expect((await notify({ ...paidEvent, object: { ...paidEvent.object, metadata: { paymentId: String(request.metadata?.paymentId) } } })).status).toBe(200);
      return { ...remote("pending"), metadata: request.metadata };
    });
    expect((await post()).status).toBe(201);
    await notify();
    const result = await report();
    expect(payment().status).toBe("SUCCEEDED");
    expect(money(result).net).toBe(1000);
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 1 });
  });

  it("concurrent checkout recovery, retries and paid callbacks keep one conversion", async () => {
    await post(); await notify(); await drainEvents();
    const recovery = { bookingId: booking().id, paymentId: payment().id, sessionKey: "retry-session" };
    recordPSParkCheckoutAnalytics(recovery);
    recordPSParkCheckoutAnalytics(recovery);
    await Promise.all([post(), post(), recordPaidStep("ps-park", booking().id, { amountRub: 1000 })]);
    const result = await report();
    expect(events.filter(row => row.step === "paid")).toHaveLength(1);
    expect(prisma.productEvent.upsert).toHaveBeenCalledTimes(6);
    expect(money(result).net).toBe(1000);
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 1 });
  });

  it.each(["PENDING", "CANCELED", "test"])("recovery does not turn %s into a paid conversion", async (state) => {
    await post(); await drainEvents();
    payments.set(payment().id, { ...payment(), status: state === "test" ? "SUCCEEDED" : state as Payment["status"], isTest: state === "test" });
    recordPSParkCheckoutAnalytics({ bookingId: booking().id, paymentId: payment().id, sessionKey: "retry-session" });
    await drainEvents();
    expect(events.filter(row => row.step === "paid")).toHaveLength(0);
    expect(prisma.payment.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
      id: payment().id, subjectId: booking().id, subjectType: "BOOKING", moduleSlug: "ps-park",
      status: "SUCCEEDED", isTest: false, currency: "RUB",
    } }));
  });

  it("slow submitted telemetry does not delay checkout and still recovers early success", async () => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(prisma.productEvent.create).mockImplementationOnce((async ({ data }: { data: ProductEvent }) => {
      await delayed;
      const row = { ...data, id: "delayed-submitted", createdAt: new Date() };
      events.push(row); return row;
    }) as never);
    // This response must resolve while the telemetry write is still pending.
    expect((await post()).status).toBe(201);
    expect(events).toHaveLength(0);
    await notify();
    release();
    const result = await report();
    expect(funnel(result)).toMatchObject({ submitted: 1, paid: 1 });
  });

  it("telemetry storage/read failures do not fail checkout or accepted payment", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(prisma.productEvent.create).mockRejectedValue(new Error("telemetry unavailable"));
      vi.mocked(prisma.payment.findFirst).mockRejectedValue(new Error("analytics query failed"));
      expect((await post()).status).toBe(201);
      expect((await notify()).status).toBe(200);
      await drainEvents();
      expect(payment().status).toBe("SUCCEEDED");
      expect(booking().status).toBe("CONFIRMED");
      expect(ledger).toHaveLength(1);
    } finally { errorLog.mockRestore(); }
  });
});
