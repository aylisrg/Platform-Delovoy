import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessReport } from "../business-types";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  report: vi.fn(),
  telegram: vi.fn(),
  preference: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  log: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  contact: { findUnique: vi.fn() },
  audit: { create: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { notificationEventPreference: mocks.preference, notificationLog: mocks.log, telegramBotContact: mocks.contact, auditLog: mocks.audit, $transaction: mocks.transaction } }));
vi.mock("@/lib/telegram/client", () => ({ telegramApi: mocks.telegram }));
vi.mock("../business-access", () => ({ getBusinessViewer: mocks.user }));
vi.mock("../business-service", () => ({
  getBusinessReport: mocks.report,
  businessDay: (date: Date) => new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10),
}));
// Keep the real pure status policy, but avoid importing its DB writes.
vi.mock("@/modules/telegram-link/bot-contact", async importOriginal => {
  const actual = await importOriginal<typeof import("@/modules/telegram-link/bot-contact")>();
  return { computeBotStatus: actual.computeBotStatus };
});

import { BUSINESS_WEEKLY_EVENT, buildBusinessReportMessage, getBusinessPreference, processWeeklyBusinessReports, sendBusinessTest, setBusinessPreference, weeklyReportAnchor } from "../business-reports";

const viewer = { id: "admin", role: "SUPERADMIN", telegramId: "12345", mergedIntoUserId: null, adminPermissions: [] };
const money = { receipts: 1000, refunds: 200, adjustments: 50, net: 850, cash: 300, card: 150, online: 600 };
const report: BusinessReport = {
  period: { from: "2026-10-26", to: "2026-11-01", days: 7, timezone: "Europe/Moscow" },
  generatedAt: "2026-11-02T06:00:00Z",
  totals: money, previous: { ...money, net: 750 },
  lines: [{ ...money, slug: "gazebos", label: "Барбекю Парк", bookings: 2, completed: 1, cancelled: 1, noShows: 0, orders: 0, linkedOrders: 0, knownCustomers: 1, repeatCustomers: 0, unidentifiedOperations: 0, coverage: "Учёт неполный" }],
  daily: [], funnel: [],
  quality: { excludedLedgerRows: 1, duplicateLedgerRows: 2, unknownPaymentRows: 0, warnings: [] },
  marketing: { visits: 77, adSpend: 999999, clicks: 33, fetchedAt: "2026-11-02T06:00:00Z", scope: "Весь сайт" },
};
const requestId = "d4324b25-578c-4e0f-9869-305fb07c4f48";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T06:00:00Z"));
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-only-token");
  mocks.user.mockResolvedValue(viewer);
  mocks.preference.findUnique.mockResolvedValue(null);
  mocks.preference.findMany.mockResolvedValue([{ userId: "admin" }]);
  mocks.log.findUnique.mockResolvedValue(null);
  mocks.log.findFirst.mockResolvedValue(null);
  mocks.contact.findUnique.mockResolvedValue({ startedAt: new Date("2026-10-01"), startedBackfill: false, blockedAt: null, lastContactAt: new Date("2026-10-01"), lastDeliveryOkAt: null });
  mocks.report.mockResolvedValue(report);
  mocks.telegram.mockResolvedValue({ ok: true, result: { message_id: 42 } });
  mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => callback({ notificationEventPreference: mocks.preference, notificationLog: mocks.log, auditLog: mocks.audit }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("weekly calendar and preference", () => {
  it("waits until Monday 09:00 Moscow and catches up without shifting report dates", () => {
    expect(weeklyReportAnchor(new Date("2026-11-02T05:59:59Z"))).toBeNull();
    expect(weeklyReportAnchor(new Date("2026-11-02T06:00:00Z"))?.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(weeklyReportAnchor(new Date("2026-11-08T20:59:59Z"))?.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect(weeklyReportAnchor(new Date("2026-11-08T21:00:00Z"))).toBeNull();
  });

  it("is off by default and returns no recipient identifier", async () => {
    const preference = await getBusinessPreference("admin");
    expect(preference).toMatchObject({ enabled: false, telegramReady: true, timezone: "Europe/Moscow", lastDelivery: null });
    expect(JSON.stringify(preference)).not.toContain(viewer.telegramId);
    expect(mocks.log.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "admin" }) }));
  });

  it("denies a revoked ordinary/merged account before reading preferences or touching Telegram", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(getBusinessPreference("admin")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(setBusinessPreference("admin", true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sendBusinessTest("admin", requestId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.preference.findUnique).not.toHaveBeenCalled();
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("updates own durable preference and audit in the same transaction", async () => {
    await setBusinessPreference("admin", true);
    expect(mocks.preference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_eventType: { userId: "admin", eventType: BUSINESS_WEEKLY_EVENT } },
      create: expect.objectContaining({ userId: "admin", enabled: true, timezone: "Europe/Moscow" }),
    }));
    expect(mocks.audit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "admin", metadata: { enabled: true, timezone: "Europe/Moscow" } }) }));
  });

  it("allows opt-out even after the bot is blocked and rejects opt-in", async () => {
    mocks.contact.findUnique.mockResolvedValue({ startedAt: new Date("2026-10-01"), blockedAt: new Date("2026-10-31"), lastContactAt: new Date("2026-10-01") });
    await expect(setBusinessPreference("admin", true)).rejects.toMatchObject({ code: "TELEGRAM_NOT_READY" });
    await expect(setBusinessPreference("admin", false)).resolves.toMatchObject({ enabled: false, telegramReady: false });
  });

  it("uses computeBotStatus so a historical block followed by a new contact is reachable", async () => {
    mocks.contact.findUnique.mockResolvedValue({ startedAt: new Date("2026-10-01"), blockedAt: new Date("2026-10-30"), lastContactAt: new Date("2026-10-31") });
    expect((await getBusinessPreference("admin")).telegramReady).toBe(true);
  });

  it.each([null, "-123456", "0", "@someone", "123 456"])("rejects non-private target %s", async telegramId => {
    mocks.user.mockResolvedValue({ ...viewer, telegramId });
    await expect(sendBusinessTest("admin", requestId)).rejects.toMatchObject({ code: "TELEGRAM_NOT_READY" });
    expect(mocks.telegram).not.toHaveBeenCalled();
  });
});

describe("delivery receipts and dedup", () => {
  it("sends one labelled test to fresh self mapping, with protected dated report link", async () => {
    const sent = await sendBusinessTest("admin", requestId);
    expect(sent).toEqual({ sent: true, status: "SENT", messageId: 42 });
    expect(mocks.report).toHaveBeenCalledWith("7d", new Date("2026-11-01T21:00:00Z"), false);
    expect(mocks.telegram).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ chat_id: "12345", text: expect.stringContaining("ТЕСТ"), reply_markup: expect.objectContaining({ inline_keyboard: expect.arrayContaining([[{ text: "Открыть визуальный отчёт", url: "https://delovoy-park.ru/admin/analytics/business?period=7d&weekEnding=2026-11-01" }]]) }) }), { allowFallback: false });
    expect(mocks.preference.upsert).not.toHaveBeenCalled();
    expect(mocks.log.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", message: "business-report receipt:42" }) }));
    expect(JSON.stringify(mocks.audit.create.mock.calls)).not.toContain("999999");
  });

  it("returns a saved receipt without resending the same request", async () => {
    mocks.log.findUnique.mockResolvedValue({ status: "SENT", message: "business-report receipt:42" });
    expect(await sendBusinessTest("admin", requestId)).toEqual({ sent: true, status: "SENT", messageId: 42 });
    expect(mocks.telegram).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("resolves a concurrent claim loser without sending", async () => {
    mocks.log.create.mockRejectedValue({ code: "P2002" });
    mocks.log.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "PENDING", message: "business-report pending" });
    expect(await sendBusinessTest("admin", requestId)).toEqual({ sent: false, status: "UNKNOWN" });
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("rechecks revoked access after aggregation before sending", async () => {
    mocks.user.mockResolvedValueOnce(viewer).mockResolvedValueOnce(null);
    expect(await sendBusinessTest("admin", requestId)).toEqual({ sent: false, status: "SKIPPED" });
    expect(mocks.telegram).not.toHaveBeenCalled();
    expect(mocks.log.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED", error: "ACCESS_OR_SUBSCRIPTION_REVOKED" }) }));
  });

  it.each([
    { ok: false, transportError: true, retryable: true, description: "timeout" },
    { ok: true, result: undefined },
    { ok: false, transportError: false, status: 502, description: "upstream" },
  ])("records ambiguous transport outcome without automatic resend", async response => {
    mocks.telegram.mockResolvedValue(response);
    expect(await sendBusinessTest("admin", requestId)).toEqual({ sent: false, status: "UNKNOWN" });
    expect(mocks.telegram).toHaveBeenCalledTimes(1);
    expect(mocks.log.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", error: "DELIVERY_UNKNOWN" }) }));
  });

  it("marks an explicit Telegram rejection failed with no raw provider text", async () => {
    mocks.telegram.mockResolvedValue({ ok: false, transportError: false, status: 403, description: "private text" });
    expect(await sendBusinessTest("admin", requestId)).toEqual({ sent: false, status: "FAILED" });
    expect(JSON.stringify(mocks.log.update.mock.calls)).not.toContain("private text");
  });

  it("preserves confirmed receipt if storing it fails, without another send", async () => {
    mocks.log.update.mockRejectedValue(new Error("db down"));
    expect(await sendBusinessTest("admin", requestId)).toEqual({ sent: true, status: "SENT_LOG_PENDING", messageId: 42 });
    expect(mocks.telegram).toHaveBeenCalledTimes(1);
  });

  it("reports pending persisted deliveries as unknown", async () => {
    mocks.log.findFirst.mockResolvedValue({ status: "PENDING", createdAt: new Date(), sentAt: null });
    expect((await getBusinessPreference("admin")).lastDelivery?.status).toBe("UNKNOWN");
  });
});

describe("weekly processing", () => {
  it("does not run before 09:00 Monday or with missing bot configuration", async () => {
    expect(await processWeeklyBusinessReports(new Date("2026-11-02T05:00:00Z"))).toEqual({ sent: 0, skipped: 0, failed: 0 });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(await processWeeklyBusinessReports()).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(mocks.preference.findMany).not.toHaveBeenCalled();
  });

  it("queries opt-in only, sends a completed week and never includes marketing office numbers", async () => {
    mocks.preference.findUnique.mockResolvedValue({ enabled: true });
    expect(await processWeeklyBusinessReports()).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(mocks.preference.findMany).toHaveBeenCalledWith({ where: { eventType: BUSINESS_WEEKLY_EVENT, enabled: true }, select: { userId: true } });
    expect(mocks.log.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: "business-weekly:admin:2026-11-01", recipient: "self" }) }));
    const text = mocks.telegram.mock.calls[0][1].text as string;
    expect(text).not.toContain("999999");
    expect(text).toContain("Офисы исключены");
    expect(text).toContain("Это не прибыль");
  });

  it("skips every durable prior claim, including unknown delivery", async () => {
    mocks.log.findUnique.mockResolvedValue({ id: "existing", status: "PENDING" });
    expect(await processWeeklyBusinessReports()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(mocks.telegram).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("honors opt-out that happens while report is built", async () => {
    mocks.preference.findUnique.mockResolvedValue({ enabled: false });
    expect(await processWeeklyBusinessReports()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("does not claim or send fabricated report when aggregation fails", async () => {
    mocks.report.mockRejectedValue(new Error("database unavailable"));
    expect(await processWeeklyBusinessReports()).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(mocks.log.create).not.toHaveBeenCalled();
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("skips revoked staff even with a stale opt-in", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await processWeeklyBusinessReports()).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.telegram).not.toHaveBeenCalled();
  });

  it("formats negative net and exact zero without inventing a percentage", () => {
    const text = buildBusinessReportMessage({ ...report, totals: { ...money, net: -50, receipts: 0 } });
    expect(text).toContain("Нетто: -50 ₽");
    expect(text).toContain("Учтённые поступления: 0 ₽");
    expect(text).not.toContain("%");
  });
});
