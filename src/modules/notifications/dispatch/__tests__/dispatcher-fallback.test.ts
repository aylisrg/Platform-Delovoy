import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock before imports so hoisting works
vi.mock("@/lib/db", () => ({
  prisma: {
    outgoingNotification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
import { processOutgoing } from "../dispatcher";
import { ChannelRegistry } from "../channel-registry";

const mockTgChannel = { isAvailable: () => true, send: vi.fn(), kind: "TELEGRAM" };
const mockEmailChannel = { isAvailable: () => true, send: vi.fn(), kind: "EMAIL" };

function makeOutgoing(overrides: Partial<{
  id: string;
  userId: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  channelId: string;
  channel: { id: string; kind: string; address: string; priority: number; userId: string; isActive: boolean; verifiedAt: Date | null };
  payload: object;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor: Date;
  sentAt: Date | null;
  failureReason: string | null;
  dedupKey: string;
  triedChannelIds: string[];
  fallbackOfId: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "on-1",
    userId: "u-1",
    eventType: "BROADCAST",
    entityType: null,
    entityId: null,
    channelId: "ch-tg",
    channel: { id: "ch-tg", kind: "TELEGRAM", address: "123456", priority: 0, userId: "u-1", isActive: true, verifiedAt: new Date() },
    payload: { title: "Test", body: "Hello" },
    status: "PENDING",
    attempts: 0,
    maxAttempts: 3,
    scheduledFor: new Date(Date.now() - 1000),
    sentAt: null,
    failureReason: null,
    dedupKey: "dedup-abc",
    triedChannelIds: [],
    fallbackOfId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Register mock channels
  ChannelRegistry.reset();
  ChannelRegistry.register(mockTgChannel as never);
  ChannelRegistry.register(mockEmailChannel as never);
  vi.mocked(prisma.outgoingNotification.update).mockResolvedValue({} as never);
  vi.mocked(prisma.outgoingNotification.create).mockResolvedValue({} as never);
  vi.mocked(prisma.systemEvent.create).mockResolvedValue({} as never);
});

describe("processOutgoing — channel fallback", () => {
  it("sends successfully when channel works", async () => {
    const item = makeOutgoing();
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([item] as never);
    vi.mocked(mockTgChannel.send).mockResolvedValueOnce({ ok: true });

    const result = await processOutgoing();

    expect(result).toEqual({ sent: 1, failed: 0, processed: 1 });
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(prisma.outgoingNotification.create).not.toHaveBeenCalled();
  });

  it("retries same channel when retryable failure and attempts not exhausted", async () => {
    const item = makeOutgoing({ attempts: 0, maxAttempts: 3 });
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([item] as never);
    vi.mocked(mockTgChannel.send).mockResolvedValueOnce({ ok: false, retryable: true, reason: "timeout" });

    const result = await processOutgoing();

    expect(result).toEqual({ sent: 0, failed: 0, processed: 1 });
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    );
    expect(prisma.outgoingNotification.create).not.toHaveBeenCalled();
  });

  it("falls back to email when telegram exhausts retries", async () => {
    const item = makeOutgoing({ attempts: 2, maxAttempts: 3 });
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([item] as never);
    vi.mocked(mockTgChannel.send).mockResolvedValueOnce({ ok: false, retryable: true, reason: "blocked" });

    const emailChannel = { id: "ch-email", kind: "EMAIL", address: "user@test.com", priority: 1, userId: "u-1", isActive: true, verifiedAt: new Date() };
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValueOnce(emailChannel as never);

    const result = await processOutgoing();

    // TG exhausted → FAILED, fallback to email queued
    expect(result).toEqual({ sent: 0, failed: 1, processed: 1 });
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(prisma.outgoingNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channelId: "ch-email",
          triedChannelIds: ["ch-tg"],
          fallbackOfId: "on-1",
          status: "PENDING",
        }),
      })
    );
  });

  it("logs SystemEvent when all channels exhausted", async () => {
    const item = makeOutgoing({ attempts: 2, maxAttempts: 3, triedChannelIds: ["ch-email"] });
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([item] as never);
    vi.mocked(mockTgChannel.send).mockResolvedValueOnce({ ok: false, retryable: false, reason: "auth" });
    // No next channel available
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValueOnce(null);

    const result = await processOutgoing();

    expect(result).toEqual({ sent: 0, failed: 1, processed: 1 });
    expect(prisma.systemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: "WARNING" }) })
    );
    expect(prisma.outgoingNotification.create).not.toHaveBeenCalled();
  });

  it("falls back immediately when channel unavailable (no send attempt)", async () => {
    // Channel registered but unavailable
    const unavailableTg = { isAvailable: () => false, send: vi.fn(), kind: "TELEGRAM" };
    ChannelRegistry.reset();
    ChannelRegistry.register(unavailableTg as never);
    ChannelRegistry.register(mockEmailChannel as never);

    const item = makeOutgoing();
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([item] as never);

    const emailChannel = { id: "ch-email", kind: "EMAIL", address: "u@test.com", priority: 1, userId: "u-1", isActive: true, verifiedAt: new Date() };
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValueOnce(emailChannel as never);

    await processOutgoing();

    expect(unavailableTg.send).not.toHaveBeenCalled();
    expect(prisma.outgoingNotification.create).toHaveBeenCalled();
  });
});
