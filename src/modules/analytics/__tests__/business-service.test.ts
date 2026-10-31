import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ financialTransaction: { findMany: vi.fn() }, booking: { findMany: vi.fn() }, order: { findMany: vi.fn() }, productEvent: { findMany: vi.fn() }, payment: { findMany: vi.fn() }, paymentRefund: { findMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("../service", () => ({ getCampaigns: vi.fn() }));
vi.mock("../metrika-client", () => ({ MetrikaClient: vi.fn() }));
import { getBusinessReport, businessCsv } from "../business-service";
import { businessWindow } from "../business-dates";
import { businessQuerySchema, businessPreferenceSchema, businessTestSchema } from "../business-validation";
const now = new Date("2026-10-26T06:00:00Z");
const ledgerRow = (id: string, type: string, amount: number, metadata = {}, moduleSlug = "ps-park", createdAt = new Date("2026-10-22T12:00Z")) => ({ id, moduleSlug, type, totalAmount: amount, cashAmount: type === "SESSION_PAYMENT" || type === "ADJUSTMENT" ? amount : 0, cardAmount: 0, metadata, createdAt });
const payment = (id: string, amount: number, overrides = {}) => ({ id, amount, isTest: false, currency: "RUB", moduleSlug: "ps-park", subjectType: "BOOKING", subjectId: "booking1", status: "SUCCEEDED", paidAt: new Date("2026-10-22T12:00Z"), ...overrides });
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
  for (const model of [db.financialTransaction, db.booking, db.order, db.productEvent, db.payment, db.paymentRefund]) model.findMany.mockResolvedValue([]);
});
describe("business accounting", () => {
  it("uses completed Moscow days across UTC midnight", () => {
    const w = businessWindow("7d", new Date("2026-10-25T21:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-10-18T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-25T21:00:00.000Z");
    expect(w.previousStart.toISOString()).toBe("2026-10-11T21:00:00.000Z");
  });
  it("keeps zero and missing marketing distinct and excludes offices in every DB domain filter", async () => {
    const report = await getBusinessReport("7d", now, false);
    expect(report.totals.net).toBe(0); expect(report.marketing.adSpend).toBeNull(); expect(report.daily).toHaveLength(7);
    expect(db.financialTransaction.findMany.mock.calls[0][0].where.moduleSlug.in).toEqual(["gazebos", "ps-park", "cafe"]);
    expect(db.booking.findMany.mock.calls[0][0].where.moduleSlug.in).not.toContain("rental");
    expect(db.order.findMany.mock.calls[0][0].where.moduleSlug).toBe("cafe");
    expect(db.productEvent.findMany.mock.calls[0][0].where.funnel.in).not.toContain("rental");
    expect(report.lines.every(l => typeof l.label === "string" && Number.isFinite(l.net))).toBe(true);
  });
  it("counts ledger once, includes adjustment, refunds in their own period, never adds orders", async () => {
    const rows = [ledgerRow("cash", "SESSION_PAYMENT", 120), ledgerRow("extra", "ADJUSTMENT", 20), ledgerRow("online", "ONLINE_PAYMENT", 500, { paymentId: "p1" }), ledgerRow("return", "REFUND", -150, { paymentId: "p0", refundId: "r1" })];
    db.financialTransaction.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows.slice(2));
    db.payment.findMany.mockResolvedValue([payment("p1", 500), payment("p0", 900, { status: "PARTIALLY_REFUNDED", paidAt: new Date("2026-09-01T12:00Z") })]);
    db.paymentRefund.findMany.mockResolvedValue([{ id: "r1", paymentId: "p0", status: "succeeded", amount: 150 }]);
    db.order.findMany.mockResolvedValue([{ id: "o1", status: "DELIVERED", bookingId: "b1", createdAt: new Date("2026-10-22T12:00Z"), userId: null, totalAmount: 99999 }]);
    const report = await getBusinessReport("7d", now, false);
    expect(report.totals).toEqual({ receipts: 620, refunds: 150, adjustments: 20, net: 490, cash: 140, card: 0, online: 500 });
    expect(report.lines.find(l => l.slug === "cafe")?.linkedOrders).toBe(1);
    expect(report.daily.reduce((sum, d) => sum + d.net, 0)).toBe(490);
    expect(businessCsv(report)).toContain("офисы исключены");
  });
  it("rejects test, orphan, foreign module and duplicated payments across period boundary", async () => {
    const rows = [ledgerRow("test", "ONLINE_PAYMENT", 100, { paymentId: "test" }), ledgerRow("orphan", "ONLINE_PAYMENT", 100, { paymentId: "missing" }), ledgerRow("duplicate", "ONLINE_PAYMENT", 100, { paymentId: "real" }), ledgerRow("office", "SESSION_PAYMENT", 77777, {}, "rental")];
    db.financialTransaction.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([ledgerRow("original", "ONLINE_PAYMENT", 100, { paymentId: "real" }, "ps-park", new Date("2026-09-01T12:00Z")), ...rows]);
    db.payment.findMany.mockResolvedValue([payment("test", 100, { isTest: true }), payment("real", 100)]);
    const report = await getBusinessReport("7d", now, false);
    expect(report.totals.net).toBe(0); expect(report.quality.duplicateLedgerRows).toBe(1); expect(report.quality.excludedLedgerRows).toBe(2);
  });
  it("does not let malformed earlier references hide a valid real payment", async () => {
    const valid = ledgerRow("valid", "ONLINE_PAYMENT", 100, { paymentId: "p" });
    const invalid = ledgerRow("invalid", "ONLINE_PAYMENT", 1, { paymentId: "p" }, "ps-park", new Date("2026-09-01T12:00Z"));
    db.financialTransaction.findMany.mockResolvedValueOnce([valid]).mockResolvedValueOnce([invalid, valid]);
    db.payment.findMany.mockResolvedValue([payment("p", 100)]);
    const report = await getBusinessReport("7d", now, false);
    expect(report.totals.net).toBe(100); expect(report.quality.duplicateLedgerRows).toBe(0);
  });
  it("keeps partial refunds separate and exposes missing ledger payments", async () => {
    const rows = [ledgerRow("refund1", "REFUND", -20, { paymentId: "p", refundId: "r1" }), ledgerRow("refund2", "REFUND", -30, { paymentId: "p", refundId: "r2" })];
    db.financialTransaction.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    db.payment.findMany.mockResolvedValue([payment("p", 200, { status: "PARTIALLY_REFUNDED" })]);
    db.paymentRefund.findMany.mockResolvedValue([{ id: "r1", paymentId: "p", amount: 20, status: "succeeded" }, { id: "r2", paymentId: "p", amount: 30, status: "succeeded" }]);
    const report = await getBusinessReport("7d", now, false);
    expect(report.totals.net).toBe(-50); expect(report.quality.warnings.join(" ")).toContain("без кассовой записи: 1");
  });
  it("subscription consumption is no new cash and paid events require real payment", async () => {
    db.financialTransaction.findMany.mockResolvedValueOnce([ledgerRow("sub-use", "SESSION_PAYMENT", 0, { paymentMethod: "SUBSCRIPTION" })]);
    db.productEvent.findMany.mockResolvedValue([{ funnel: "ps-park", step: "paid", entityId: "test-booking", sessionKey: "a" }]);
    const report = await getBusinessReport("7d", now, false);
    expect(report.totals.net).toBe(0); expect(report.funnel.find(f => f.slug === "ps-park")?.paid).toBe(0);
  });
  it("fails closed on DB failure", async () => {
    db.$transaction.mockRejectedValue(new Error("database unavailable"));
    await expect(getBusinessReport("7d", now, false)).rejects.toThrow("database unavailable");
  });
});
describe("business inputs", () => {
  it("rejects forged recipient, office filter and malformed periods", () => {
    expect(businessPreferenceSchema.safeParse({ enabled: true, userId: "victim" }).success).toBe(false);
    expect(businessTestSchema.safeParse({ requestId: "fake", chatId: "victim" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "365d" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "7d", module: "rental" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "7d", weekEnding: "2026-10-25" }).success).toBe(true);
    expect(businessQuerySchema.safeParse({ period: "7d", weekEnding: "2026-10-24" }).success).toBe(false);
  });
});
