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
import { processOutgoing, OUTGOING_MAX_AGE_MS, STALE_SKIP_REASON } from "../dispatcher";
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
});

afterEach(() => vi.useRealTimers());

describe("processOutgoing stale cutoff (#917)", () => {
  it("threshold is 24h", () => {
    expect(OUTGOING_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("marks items older than 24h as SKIPPED with reason and does not send", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([
      item("old", new Date(NOW.getTime() - OUTGOING_MAX_AGE_MS - 60_000)),
    ] as never);
    const res = await processOutgoing();
    expect(send).not.toHaveBeenCalled();
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith({
      where: { id: "old" },
      data: { status: "SKIPPED", failureReason: STALE_SKIP_REASON, failureCode: "STALE" },
    });
    expect(res).toMatchObject({ sent: 0, failed: 0, skipped: 1, processed: 1 });
  });

  it("sends fresh items", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([
      item("fresh", new Date(NOW.getTime() - 5 * 60_000)),
    ] as never);
    const res = await processOutgoing();
    expect(send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ sent: 1, skipped: 0 });
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "fresh" }, data: expect.objectContaining({ status: "SENT" }) })
    );
  });

  it("boundary: exactly 24h old is sent, 24h + 1ms is skipped", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValue([
      item("edge", new Date(NOW.getTime() - OUTGOING_MAX_AGE_MS)),
      item("past", new Date(NOW.getTime() - OUTGOING_MAX_AGE_MS - 1)),
    ] as never);
    const res = await processOutgoing();
    expect(send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ sent: 1, skipped: 1, processed: 2 });
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith({
      where: { id: "past" },
      data: { status: "SKIPPED", failureReason: STALE_SKIP_REASON, failureCode: "STALE" },
    });
  });
});
