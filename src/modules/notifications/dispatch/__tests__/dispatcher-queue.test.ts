import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock before imports so hoisting works
vi.mock("@/lib/db", () => ({
  prisma: {
    outgoingNotification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userNotificationChannel: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    notificationGlobalPreference: { findUnique: vi.fn() },
    notificationEventPreference: { findUnique: vi.fn() },
    systemEvent: { create: vi.fn() },
  },
}));

vi.mock("../channels", () => ({ bootstrapChannels: vi.fn() }));


import { prisma } from "@/lib/db";
import { processOutgoing, OUTGOING_CLAIM_LEASE_MS, retryDelayMs } from "../dispatcher";
import { ChannelRegistry } from "../channel-registry";

const NOW = new Date("2026-10-13T10:00:00Z");
const send = vi.fn();
const tg = { isAvailable: () => true, send, kind: "TELEGRAM" };

function item(id: string, scheduledFor: Date) {
  return {
    id,
    userId: "u-1",
    eventType: "BOOKING_REMINDER",
    entityType: null,
    entityId: null,
    channelId: "ch-tg",
    channel: { id: "ch-tg", kind: "TELEGRAM", address: "123", priority: 0, userId: "u-1", isActive: true, verifiedAt: NOW },
    payload: { title: "T", body: "B" },
    status: "PENDING",
    attempts: 0,
    maxAttempts: 3,
    scheduledFor,
    sentAt: null,
    failureReason: null,
    dedupKey: "d",
    triedChannelIds: [],
    fallbackOfId: null,
    createdAt: scheduledFor,
    updatedAt: scheduledFor,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  ChannelRegistry.reset();
  ChannelRegistry.register(tg as never);
  send.mockResolvedValue({ ok: true });
  vi.mocked(prisma.outgoingNotification.update).mockResolvedValue({} as never);
  vi.mocked(prisma.outgoingNotification.updateMany).mockResolvedValue({ count: 1 } as never);
});

afterEach(() => vi.useRealTimers());

const due = (id: string, minAgo = 1, extra: Record<string, unknown> = {}) => ({
  ...item(id, new Date(NOW.getTime() - minAgo * 60_000)),
  ...extra,
});

describe("processOutgoing queue (#708/#917)", () => {
  it("drains a backlog of 19 due messages in one run", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue(
      Array.from({ length: 19 }, (_, i) => due(`m${i}`, 60 + i)) as never
    );
    const res = await processOutgoing(100);
    expect(res).toEqual({ sent: 19, failed: 0, skipped: 0, processed: 19 });
    expect(send).toHaveBeenCalledTimes(19);
  });

  it("selects PENDING and DEFERRED that are due, oldest first, within batch", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([] as never);
    await processOutgoing(50);
    expect(prisma.outgoingNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["PENDING", "DEFERRED"] }, scheduledFor: { lte: NOW } },
        orderBy: { scheduledFor: "asc" },
        take: 50,
      })
    );
  });

  it("claims each row with a lease conditioned on status and scheduledFor", async () => {
    const it1 = due("a");
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([it1] as never);
    await processOutgoing();
    expect(prisma.outgoingNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "a", status: "PENDING", scheduledFor: it1.scheduledFor },
      data: { scheduledFor: new Date(NOW.getTime() + OUTGOING_CLAIM_LEASE_MS) },
    });
  });

  it("skips rows already claimed by an overlapping run (no double send)", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([due("a"), due("b")] as never);
    vi.mocked(prisma.outgoingNotification.updateMany)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    const res = await processOutgoing();
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
  });

  it("a throwing delivery does not abort the batch; the row stays queued for reclaim", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([due("a"), due("b")] as never);
    send.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: true });
    const res = await processOutgoing();
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(1);
    // строку "a" не помечаем FAILED: она вернётся в выборку после аренды
    expect(prisma.outgoingNotification.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a" }, data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("reclaims a row whose lease expired (crashed run): it is due again and gets sent", async () => {
    // после краха строка осталась PENDING со scheduledFor = старое now + lease; сейчас это уже в прошлом
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([due("crashed", 1)] as never);
    const res = await processOutgoing();
    expect(res.sent).toBe(1);
  });

  it("retryable failure reschedules with exponential backoff and keeps PENDING", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([due("a", 1, { attempts: 1 })] as never);
    send.mockResolvedValue({ ok: false, reason: "UND_ERR_CONNECT_TIMEOUT", retryable: true });
    const res = await processOutgoing();
    expect(res).toMatchObject({ sent: 0, failed: 0, processed: 1 });
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: {
        status: "PENDING",
        failureReason: "UND_ERR_CONNECT_TIMEOUT",
        failureCode: "OTHER",
        attempts: 2,
        scheduledFor: new Date(NOW.getTime() + 10 * 60_000),
      },
    });
  });

  it("backoff grows 5, 10, 20 min and is capped at 60", () => {
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(2)).toBe(10 * 60_000);
    expect(retryDelayMs(3)).toBe(20 * 60_000);
    expect(retryDelayMs(10)).toBe(60 * 60_000);
  });
});
