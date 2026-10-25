import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: vi.fn(), existing: vi.fn(), owner: vi.fn(), insert: vi.fn(), audit: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: mocks.users },
    inAppNotification: { findMany: mocks.existing },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../novofon-client", () => ({ getNovofonDataApiToken: () => "test-token" }));
// Recipients come from the shared resolver (ADR 2026-10-25 §Q7): the initial
// audience query and the in-transaction recheck (with userIds) are separate mocks.
vi.mock("@/modules/notifications/audience", () => ({
  resolveStaffRouting: (input: { userIds?: string[] }, db?: unknown) =>
    input.userIds ? mocks.owner(input, db) : mocks.users(input, db),
}));
const routing = (ids: string[]) => ({
  recipients: ids.map((userId) => ({ userId, paths: ["in_app_superadmin"] })),
  suppressed: [],
  groupChat: { send: false, reason: "not_applicable" },
});

import { buildDailySummaryPayload, dailySummaryDate, dailySummaryId, fetchDailySummary, processTelephonyDailySummaries } from "../daily-summary-service";
import { TELEPHONY_DAILY_EVENT, telephonyDailySummarySchema } from "../daily-summary-types";
import { MAX_OFFSET, PAGE_LIMIT } from "../calls-sync";

const NOW = new Date("2026-10-24T06:00:00Z");
const REPORT_DATE = "2026-10-23";
const row = (id: number, fields: Record<string, unknown> = {}) => ({
  id, start_time: "2026-10-23 12:00:00", direction: "in", is_lost: false, talk_duration: 30, ...fields,
});
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const report = (rows: unknown[]) => vi.fn<typeof fetch>(async () => response({ result: { data: rows } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.users.mockResolvedValue(routing(["owner"]));
  mocks.existing.mockResolvedValue([]);
  mocks.owner.mockResolvedValue(routing(["owner"]));
  mocks.insert.mockResolvedValue({});
  mocks.audit.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback) => callback({
    user: { findFirst: mocks.owner }, inAppNotification: { create: mocks.insert }, auditLog: { create: mocks.audit },
  }));
});

describe("daily summary schedule", () => {
  it("uses the previous complete Moscow date and waits until 09:00", () => {
    expect(dailySummaryDate(new Date("2026-10-24T05:59:59Z"))).toBeNull();
    expect(dailySummaryDate(NOW)).toBe("2026-10-23");
    expect(dailySummaryDate(new Date("2026-10-24T20:59:59Z"))).toBe("2026-10-23");
    expect(dailySummaryDate(new Date("2026-10-24T21:00:00Z"))).toBeNull();
    expect(dailySummaryDate(new Date("2026-01-01T06:00:00Z"))).toBe("2025-12-31");
  });
});

describe("fetchDailySummary", () => {
  it("rejects invalid and incomplete report dates before a provider request", async () => {
    const fetchImpl = report([]);
    for (const date of ["2026-02-30", "not-a-date", "2026-10-24", "2026-10-25"]) {
      await expect(fetchDailySummary(date, NOW, { fetchImpl })).rejects.toMatchObject({ code: "invalid_date" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("counts confirmed outcomes, separates lost outbound calls and fetches exactly yesterday", async () => {
    const fetchImpl = report([
      row(1), row(2), row(3), row(4, { is_lost: true, talk_duration: 0 }),
      row(5, { is_lost: true, talk_duration: 0 }), row(6, { talk_duration: null }),
      row(7, { direction: "out", is_lost: true }), row(8, { direction: "out" }),
    ]);
    const summary = await fetchDailySummary(REPORT_DATE, NOW, { fetchImpl });
    expect(summary).toEqual({
      reportDate: REPORT_DATE, timeZone: "Europe/Moscow", generatedAt: NOW.toISOString(),
      total: 8, inbound: 6, answered: 3, missed: 2, outbound: 2, pending: 1, answerRate: 60,
    });
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string).params).toMatchObject({
      date_from: "2026-10-23 00:00:00", date_till: "2026-10-23 23:59:59", limit: PAGE_LIMIT, offset: 0,
    });
  });

  it("accepts verified empty reports, but not malformed envelopes or rows", async () => {
    const empty = await fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: report([]) });
    expect(empty.total).toBe(0);
    expect(empty.answerRate).toBeNull();
    expect(buildDailySummaryPayload(empty).body).toContain("По отчёту Novofon");
    await expect(fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: async () => response({}) })).rejects.toMatchObject({ code: "invalid_response" });
    for (const invalid of [row(1, { is_lost: "false" }), row(1, { direction: "unknown" }), row(1, { talk_duration: -1 }), row(1, { talk_duration: "30" }), row(1, { start_time: "2026-10-24 00:00:00" })]) {
      await expect(fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: report([invalid]) })).rejects.toMatchObject({ code: "invalid_response" });
    }
    await expect(fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: report([row(1), row(1)]) })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("fetches subsequent pages and refuses truncated reports", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const { offset } = JSON.parse(init?.body as string).params as { offset: number };
      return response({ result: { data: Array.from({ length: offset === 0 ? PAGE_LIMIT : 1 }, (_, i) => row(offset + i)) } });
    });
    expect((await fetchDailySummary(REPORT_DATE, NOW, { fetchImpl })).total).toBe(PAGE_LIMIT + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const endless = vi.fn<typeof fetch>(async (_input, init) => {
      const { offset } = JSON.parse(init?.body as string).params as { offset: number };
      return response({ result: { data: Array.from({ length: PAGE_LIMIT }, (_, i) => row(offset + i)) } });
    });
    await expect(fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: endless })).rejects.toMatchObject({ code: "truncated" });
    expect(endless).toHaveBeenCalledTimes(MAX_OFFSET / PAGE_LIMIT + 1);
  });

  it("does not turn a timeout or upstream error into zero calls", async () => {
    const timedOut = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Timeout", "TimeoutError"));
    await expect(fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: timedOut })).rejects.toThrow();
    await expect(fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: async () => response({ error: { code: -32602, message: "secret upstream details" } }) })).rejects.toMatchObject({ code: -32602 });
  });
});

describe("processTelephonyDailySummaries", () => {
  it("quietly skips an unconfigured integration without querying, reporting zero or publishing", async () => {
    const fetchImpl = report([]);
    await expect(processTelephonyDailySummaries(NOW, { token: "", fetchImpl })).resolves.toEqual({
      reportDate: REPORT_DATE, created: 0, skipped: 0, reason: "not_configured",
    });
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing before the release time or when all recipients already have a snapshot", async () => {
    const fetchImpl = report([row(1)]);
    await expect(processTelephonyDailySummaries(new Date("2026-10-24T05:59:59Z"), { fetchImpl })).resolves.toMatchObject({ created: 0 });
    expect(mocks.users).not.toHaveBeenCalled();
    mocks.existing.mockResolvedValue([{ id: dailySummaryId(REPORT_DATE, "owner") }]);
    await expect(processTelephonyDailySummaries(NOW, { fetchImpl })).resolves.toMatchObject({ created: 0, skipped: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates an immutable in-app snapshot and its audit atomically for default-enabled owners only", async () => {
    await expect(processTelephonyDailySummaries(NOW, { fetchImpl: report([row(1)]) })).resolves.toEqual({ reportDate: REPORT_DATE, created: 1, skipped: 0 });
    expect(mocks.users.mock.calls[0][0]).toEqual({ eventType: TELEPHONY_DAILY_EVENT, moduleSlug: null });
    // recheck inside the transaction, against the transaction client
    expect(mocks.owner).toHaveBeenCalledWith(
      { eventType: TELEPHONY_DAILY_EVENT, moduleSlug: null, userIds: ["owner"] },
      expect.objectContaining({ inAppNotification: expect.anything() }),
    );
    expect(mocks.insert).toHaveBeenCalledWith({ data: {
      id: dailySummaryId(REPORT_DATE, "owner"), userId: "owner", eventType: TELEPHONY_DAILY_EVENT,
      payload: expect.objectContaining({ telephonySummary: expect.objectContaining({ reportDate: REPORT_DATE, total: 1 }) }),
    } });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ entity: "InAppNotification", entityId: dailySummaryId(REPORT_DATE, "owner") }) });
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain("start_time");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("leaves no marker after provider failure and retries successfully on a later scheduler tick", async () => {
    await expect(processTelephonyDailySummaries(NOW, { fetchImpl: async () => response({}) })).rejects.toThrow();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    await expect(processTelephonyDailySummaries(new Date("2026-10-24T06:05:00Z"), { fetchImpl: report([row(1)]) })).resolves.toMatchObject({ created: 1 });
  });

  it("lets the primary key resolve concurrent retries and rechecks owner access after fetching", async () => {
    mocks.insert.mockRejectedValueOnce({ code: "P2002" });
    await expect(processTelephonyDailySummaries(NOW, { fetchImpl: report([row(1)]) })).resolves.toMatchObject({ created: 0, skipped: 1 });
    expect(mocks.audit).not.toHaveBeenCalled();
    mocks.insert.mockClear();
    mocks.owner.mockResolvedValue(routing([]));
    await expect(processTelephonyDailySummaries(NOW, { fetchImpl: report([row(1)]) })).resolves.toMatchObject({ created: 0, skipped: 1 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("retries only missing recipients and never rewrites an existing snapshot", async () => {
    mocks.users.mockResolvedValue(routing(["one", "two"]));
    mocks.existing.mockResolvedValue([{ id: dailySummaryId(REPORT_DATE, "one") }]);
    await expect(processTelephonyDailySummaries(NOW, { fetchImpl: report([row(1)]) })).resolves.toMatchObject({ created: 1, skipped: 1 });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0].data.userId).toBe("two");
  });
});

describe("telephonyDailySummarySchema", () => {
  it("rejects malformed or inconsistent payloads before rendering an aggregate card", async () => {
    const summary = await fetchDailySummary(REPORT_DATE, NOW, { fetchImpl: report([row(1)]) });
    expect(telephonyDailySummarySchema.safeParse(summary).success).toBe(true);
    expect(telephonyDailySummarySchema.safeParse({ ...summary, total: 42 }).success).toBe(false);
    expect(telephonyDailySummarySchema.safeParse({ ...summary, answered: -1 }).success).toBe(false);
  });
});
