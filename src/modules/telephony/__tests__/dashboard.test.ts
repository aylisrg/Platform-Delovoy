import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    novofonCall: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("../novofon-client", () => ({ getNovofonDataApiToken: vi.fn(() => "") }));

import { prisma } from "@/lib/db";
import { getNovofonDataApiToken } from "../novofon-client";
import { getTelephonyDashboard, maskJournalPhone } from "../dashboard-service";
import { telephonyDashboardSchema } from "../dashboard-validation";

const db = vi.mocked(prisma, true);
const NOW = new Date("2026-10-24T21:15:00Z"); // October 25 in the provider's timezone.
const baseCall = {
  id: "call-1", startedAt: new Date("2026-10-24T21:05:00Z"), direction: "INBOUND" as const,
  isLost: false, contactPhone: "+7 (900) 000-12-34", employeeName: "Сотрудник",
  talkDuration: 45, waitDuration: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NOVOFON_WEBHOOK_TOKEN", "");
  vi.stubEnv("NOVOFON_WEBHOOK_SECRET", "");
  db.$queryRaw.mockResolvedValue([]);
  db.novofonCall.findMany.mockResolvedValue([]);
  db.novofonCall.count.mockResolvedValue(0);
  db.novofonCall.findFirst.mockResolvedValue(null);
  vi.mocked(getNovofonDataApiToken).mockReturnValue("");
});

describe("telephonyDashboardSchema", () => {
  it("defaults to today's first page and rejects unknown periods, filters and invalid pages", () => {
    expect(telephonyDashboardSchema.parse({})).toEqual({ period: "today", filter: "all", page: 1 });
    for (const input of [{ period: "365d" }, { filter: "failed" }, { page: "0" }, { page: "1.5" }, { page: "Infinity" }, { page: "100001" }]) {
      expect(telephonyDashboardSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("getTelephonyDashboard", () => {
  it("uses Moscow midnight and includes empty days without inventing an answer rate", async () => {
    const result = await getTelephonyDashboard({ period: "7d", filter: "all", page: 1 }, NOW);
    expect(result.dateFrom).toBe("2026-10-19");
    expect(result.dateTo).toBe("2026-10-25");
    expect(result.daily).toHaveLength(7);
    expect(result.daily[6]).toMatchObject({ date: "2026-10-25", total: 0 });
    expect(result.summary).toMatchObject({ total: 0, answerRate: null, avgTalkSeconds: null });
    expect(db.novofonCall.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { startedAt: { gte: new Date("2026-10-18T21:00:00Z"), lt: new Date("2026-10-25T21:00:00Z") } },
    }));
    const sql = db.$queryRaw.mock.calls[0][0] as { values: unknown[]; strings: string[] };
    expect(sql.values).toEqual([new Date("2026-10-18T21:00:00Z"), new Date("2026-10-25T21:00:00Z")]);
    expect(sql.strings.join("?")).toContain("interval '3 hours'");
    expect(result.source).toEqual({ dataApiConfigured: false, webhookConfigured: false, lastCallAt: null, lastJournalUpdate: null });
  });

  it("keeps period totals independent of the missed journal filter and paginates only the journal", async () => {
    db.$queryRaw.mockResolvedValue([
      { date: "2026-10-25", total: BigInt(8), inbound: BigInt(6), answered: BigInt(3), missed: BigInt(2), outbound: BigInt(2), pending: BigInt(1), talkSeconds: BigInt(225), talkCount: BigInt(5) },
    ]);
    db.novofonCall.count.mockResolvedValue(26);
    const result = await getTelephonyDashboard({ period: "today", filter: "missed", page: 2 }, NOW);
    expect(result.summary).toEqual({ total: 8, inbound: 6, answered: 3, missed: 2, outbound: 2, pending: 1, answerRate: 60, avgTalkSeconds: 45 });
    expect(result.pagination).toEqual({ page: 2, perPage: 25, total: 26, totalPages: 2 });
    expect(db.novofonCall.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ direction: "INBOUND", isLost: true }), skip: 25, take: 25,
    }));
    expect(db.novofonCall.count).toHaveBeenCalledWith({ where: expect.objectContaining({ direction: "INBOUND", isLost: true }) });
    // Only date boundaries are interpolated into the aggregates: neither journal filter nor page.
    expect((db.$queryRaw.mock.calls[0][0] as { values: unknown[] }).values).toHaveLength(2);
  });

  it("does not call recording-only rows answered or lost outbound calls missed", async () => {
    db.novofonCall.findMany.mockResolvedValue([
      { ...baseCall, id: "recording-only", talkDuration: null },
      { ...baseCall, id: "zero", talkDuration: 0 },
      { ...baseCall, id: "answered" },
      { ...baseCall, id: "missed", isLost: true, talkDuration: 0 },
      { ...baseCall, id: "outbound", direction: "OUTBOUND", isLost: true, talkDuration: 0 },
    ] as never);
    const result = await getTelephonyDashboard({ period: "today", filter: "all", page: 1 }, NOW);
    expect(result.calls.map((call) => call.outcome)).toEqual(["pending", "pending", "answered", "missed", "outbound"]);
    expect(result.calls[0].maskedPhone).toBe("••• ••• 12 34");
    expect(JSON.stringify(result)).not.toContain(baseCall.contactPhone);
    expect(result.calls[0]).not.toHaveProperty("contactPhone");
    expect(result.calls[0]).not.toHaveProperty("recordUrl");
    expect(result.calls[0]).not.toHaveProperty("employeeId");
    const select = db.novofonCall.findMany.mock.calls[0][0]?.select;
    expect(select).not.toHaveProperty("recordUrl");
    expect(select).not.toHaveProperty("recordId");
  });

  it("uses positive talk time in the answered filter and distinguishes journal updates from configuration", async () => {
    vi.mocked(getNovofonDataApiToken).mockReturnValue("configured-token");
    vi.stubEnv("NOVOFON_WEBHOOK_SECRET", "configured-secret");
    db.novofonCall.findFirst
      .mockResolvedValueOnce({ startedAt: new Date("2026-10-01T10:00:00Z") } as never)
      .mockResolvedValueOnce({ updatedAt: new Date("2026-10-24T21:10:00Z") } as never);
    const result = await getTelephonyDashboard({ period: "30d", filter: "answered", page: 1 }, NOW);
    expect(result.daily).toHaveLength(30);
    expect(db.novofonCall.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ direction: "INBOUND", isLost: false, talkDuration: { gt: 0 } }),
    }));
    expect(result.source).toEqual({
      dataApiConfigured: true, webhookConfigured: true,
      lastCallAt: "2026-10-01T10:00:00.000Z", lastJournalUpdate: "2026-10-24T21:10:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("configured-token");
    expect(JSON.stringify(result)).not.toContain("configured-secret");
  });
});

describe("maskJournalPhone", () => {
  it("never returns a full short number and handles missing contacts", () => {
    expect(maskJournalPhone(null)).toBeNull();
    expect(maskJournalPhone("1234")).toBe("•••");
    expect(maskJournalPhone("n/a")).toBe("•••");
    expect(maskJournalPhone("79998887766")).toBe("••• ••• 77 66");
  });
});
