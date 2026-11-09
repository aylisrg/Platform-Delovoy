import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), financialTransaction: { findMany: vi.fn() }, booking: { findMany: vi.fn() }, order: { findMany: vi.fn() }, productEvent: { findMany: vi.fn() }, payment: { findMany: vi.fn() }, paymentRefund: { findMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("../service", () => ({ getCampaigns: vi.fn() }));
vi.mock("../metrika-client", () => ({ MetrikaClient: vi.fn() }));
import { getBusinessReport, businessCsv } from "../business-service";
import { bucketKey, businessCalendarRanges, businessWindow, defaultGranularity } from "../business-dates";
import { businessQuerySchema, businessPreferenceSchema, businessTestSchema } from "../business-validation";
const now = new Date("2026-10-26T06:00:00Z");
const ledgerRow = (id: string, type: string, amount: number, metadata = {}, moduleSlug = "ps-park", createdAt = new Date("2026-10-22T12:00Z")) => ({ id, moduleSlug, type, totalAmount: amount, cashAmount: type === "SESSION_PAYMENT" || type === "ADJUSTMENT" ? amount : 0, cardAmount: 0, metadata, createdAt });
const payment = (id: string, amount: number, overrides = {}) => ({ id, amount, isTest: false, currency: "RUB", moduleSlug: "ps-park", subjectType: "BOOKING", subjectId: "booking1", status: "SUCCEEDED", paidAt: new Date("2026-10-22T12:00Z"), ...overrides });
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
  db.$queryRaw.mockResolvedValue([]);
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
    expect(report.totals.net).toBe(0); expect(report.marketing.adSpend).toBeNull(); expect(report.series).toMatchObject({ granularity: "day" }); expect(report.series.rows).toHaveLength(7);
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
    expect(report.series.rows.reduce((sum, d) => sum + d.net, 0)).toBe(490);
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
  it("covers an inclusive custom range with an equal-length comparison window", () => {
    const w = businessWindow({ from: "2025-01-01", to: "2025-12-31" });
    expect(w.days).toBe(365);
    expect(w.start.toISOString()).toBe("2024-12-31T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2025-12-31T21:00:00.000Z");
    expect(w.previousStart.toISOString()).toBe("2024-01-01T21:00:00.000Z"); // 365 days back across the 2024 leap day
  });
  it("groups by ISO week and calendar month, picking a readable default", () => {
    expect(bucketKey("2026-11-08", "week")).toBe("2026-11-02");
    expect(bucketKey("2026-11-09", "week")).toBe("2026-11-09");
    expect(bucketKey("2026-02-28", "month")).toBe("2026-02-01");
    expect([defaultGranularity(30), defaultGranularity(90), defaultGranularity(365)]).toEqual(["day", "week", "month"]);
  });
  it("builds month buckets clipped to the range whose money and operations add up to totals", async () => {
    const rows = [
      ledgerRow("jan", "SESSION_PAYMENT", 1000, {}, "ps-park", new Date("2026-01-20T10:00Z")),
      ledgerRow("feb", "SESSION_PAYMENT", 300, {}, "gazebos", new Date("2026-02-28T20:59Z")),
      ledgerRow("mar", "SESSION_PAYMENT", 50, {}, "cafe", new Date("2026-02-28T21:00Z")),
      ledgerRow("before", "SESSION_PAYMENT", 7, {}, "cafe", new Date("2025-12-20T10:00Z")),
    ];
    db.financialTransaction.findMany.mockResolvedValueOnce(rows);
    db.booking.findMany.mockResolvedValue([
      { id: "b1", moduleSlug: "ps-park", status: "COMPLETED", startTime: new Date("2026-01-16T10:00Z"), userId: "u1" },
      { id: "b2", moduleSlug: "ps-park", status: "CANCELLED", startTime: new Date("2026-03-10T10:00Z"), userId: null },
    ]);
    const report = await getBusinessReport({ from: "2026-01-15", to: "2026-03-10" }, now, false, "month");
    expect(report.period).toMatchObject({ from: "2026-01-15", to: "2026-03-10", days: 55 });
    expect(report.series.rows.map(r => [r.from, r.to, r.net])).toEqual([["2026-01-15", "2026-01-31", 1000], ["2026-02-01", "2026-02-28", 300], ["2026-03-01", "2026-03-10", 50]]);
    expect(report.series.rows[2].lines.cafe.net).toBe(50);
    expect(report.series.rows[0].lines["ps-park"]).toMatchObject({ operations: 1, completed: 1 });
    expect(report.series.rows[2].lines["ps-park"]).toMatchObject({ operations: 1, cancelled: 1 });
    expect(report.series.rows.reduce((sum, r) => sum + r.net, 0)).toBe(report.totals.net);
    expect(report.previous.net).toBe(7);
    const csv = businessCsv(report);
    expect(csv).toContain('"Месяц";"2026-02-01";"2026-02-28";"Барбекю Парк";"300"');
    expect(csv).toContain('"Итог периода";"2026-01-15";"2026-03-10";"Все направления";"1350"');
  });
  it("takes visitor-day funnel counts from SQL and entity steps from rows", async () => {
    db.$queryRaw.mockResolvedValue([{ funnel: "gazebos", stage: "view", visitors: 120 }, { funnel: "gazebos", stage: "started", visitors: 30 }]);
    db.productEvent.findMany.mockResolvedValue([{ funnel: "gazebos", step: "submitted", entityId: "b1" }, { funnel: "gazebos", step: "submitted", entityId: "b1" }]);
    const report = await getBusinessReport("365d", now, false);
    expect(report.funnel.find(f => f.slug === "gazebos")).toEqual({ slug: "gazebos", views: 120, started: 30, submitted: 1, paid: 0 });
    expect(db.productEvent.findMany.mock.calls[0][0].where.step.in).toEqual(["submitted", "paid"]);
    expect(report.series.granularity).toBe("month");
  });
  it("offers calendar shortcuts that end no later than yesterday", () => {
    expect(businessCalendarRanges("2026-11-09")).toEqual([
      { key: "last-month", label: "Прошлый месяц", from: "2026-10-01", to: "2026-10-31" },
      { key: "last-quarter", label: "Прошлый квартал", from: "2026-07-01", to: "2026-09-30" },
      { key: "year-to-date", label: "С начала года", from: "2026-01-01", to: "2026-11-08" },
      { key: "last-year", label: "Прошлый год", from: "2025-01-01", to: "2025-12-31" },
    ]);
    const newYear = businessCalendarRanges("2026-01-01");
    expect(newYear.map(r => r.key)).toEqual(["last-month", "last-quarter", "last-year"]);
    expect(newYear[0]).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(newYear[1]).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
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
    expect(businessQuerySchema.safeParse({ period: "730d" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "7d", module: "rental" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "7d", weekEnding: "2026-10-25" }).success).toBe(true);
    expect(businessQuerySchema.safeParse({ period: "7d", weekEnding: "2026-10-24" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "365d" }).success).toBe(true);
    expect(businessQuerySchema.safeParse({ period: "custom", from: "2024-11-01", to: "2026-10-31", granularity: "month" }).success).toBe(true);
    expect(businessQuerySchema.safeParse({ period: "custom", from: "2024-01-01", to: "2026-10-31" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "custom", to: "2026-10-31" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "custom", from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "custom", from: "2026-10-01", to: "2999-01-01" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "90d", from: "2026-10-01", to: "2026-10-31" }).success).toBe(false);
    expect(businessQuerySchema.safeParse({ period: "90d", granularity: "quarter" }).success).toBe(false);
  });
});
