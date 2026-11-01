import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    outgoingNotification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    userNotificationChannel: { findMany: vi.fn(), findFirst: vi.fn() },
    notificationGlobalPreference: { findUnique: vi.fn() },
    notificationEventPreference: { findUnique: vi.fn() },
    systemEvent: { create: vi.fn() },
  },
}));
vi.mock("../channels", () => ({ bootstrapChannels: vi.fn() }));

const mockEnsureLinks = vi.fn();
vi.mock("../../tracking/link-service", () => ({
  ensureLinksForDelivery: (...a: unknown[]) => mockEnsureLinks(...a),
}));
const mockRecordSkip = vi.fn();
vi.mock("../../skips", () => ({ recordSkip: (...a: unknown[]) => mockRecordSkip(...a) }));
const mockProof = vi.fn();
const mockBlocked = vi.fn();
vi.mock("@/modules/telegram-link/bot-contact", () => ({
  recordDeliveryProof: (...a: unknown[]) => mockProof(...a),
  recordBotBlocked: (...a: unknown[]) => mockBlocked(...a),
}));
const mockIsDuplicate = vi.fn();
vi.mock("../dedup", () => ({
  computeDedupKey: () => "dk",
  isDuplicate: (...a: unknown[]) => mockIsDuplicate(...a),
}));

import { prisma } from "@/lib/db";
import { dispatch, processOutgoing } from "../dispatcher";
import { ChannelRegistry } from "../channel-registry";

const tg = { isAvailable: () => true, send: vi.fn(), kind: "TELEGRAM" };
const vk = { isAvailable: () => true, send: vi.fn(), kind: "VK" };

function outgoing(overrides: Record<string, unknown> = {}) {
  return {
    id: "on-1",
    userId: "u-1",
    eventType: "booking.created",
    entityType: "Booking",
    entityId: "b-1",
    channelId: "ch-tg",
    channel: { id: "ch-tg", kind: "TELEGRAM", address: "555", priority: 0, userId: "u-1", isActive: true, verifiedAt: new Date() },
    payload: { title: "Новая бронь", body: "…", actions: [{ label: "Открыть", url: "/admin/gazebos" }] },
    status: "PENDING",
    attempts: 0,
    maxAttempts: 3,
    scheduledFor: new Date(Date.now() - 1000),
    dedupKey: "dk",
    triedChannelIds: [],
    fallbackOfId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ChannelRegistry.reset();
  ChannelRegistry.register(tg as never);
  ChannelRegistry.register(vk as never);
  vi.mocked(prisma.outgoingNotification.update).mockResolvedValue({} as never);
  vi.mocked(prisma.systemEvent.create).mockResolvedValue({} as never);
  mockEnsureLinks.mockResolvedValue([{ label: "Открыть", url: "https://delovoy-park.ru/r/AAAAAAAAAAAAAAAAAAAAAA" }]);
});

describe("deliverOne — tracking links (AC-D3.1)", () => {
  it("swaps catalog-event buttons on external channels for tracking links and stores externalId", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([outgoing()] as never);
    tg.send.mockResolvedValueOnce({ ok: true, externalId: "777" });

    await processOutgoing();

    expect(mockEnsureLinks).toHaveBeenCalledWith(
      expect.objectContaining({ id: "on-1", fallbackOfId: null }),
      [{ label: "Открыть", url: "/admin/gazebos" }],
    );
    expect(tg.send).toHaveBeenCalledWith("555", expect.objectContaining({
      actions: [{ label: "Открыть", url: "https://delovoy-park.ru/r/AAAAAAAAAAAAAAAAAAAAAA" }],
    }));
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENT", externalId: "777" }),
    }));
    expect(mockProof).toHaveBeenCalledWith("555");
  });

  it("leaves non-catalog events and non-tracked channels untouched", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([
      outgoing({ eventType: "BROADCAST" }),
      outgoing({ id: "on-2", channel: { id: "ch-vk", kind: "VK", address: "v1", priority: 0, userId: "u-1", isActive: true, verifiedAt: new Date() } }),
    ] as never);
    tg.send.mockResolvedValue({ ok: true });
    vk.send.mockResolvedValue({ ok: true });

    await processOutgoing();
    expect(mockEnsureLinks).not.toHaveBeenCalled();
    expect(tg.send).toHaveBeenCalledWith("555", expect.objectContaining({ actions: [{ label: "Открыть", url: "/admin/gazebos" }] }));
  });

  it("falls back to the original buttons when link creation fails", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([outgoing()] as never);
    mockEnsureLinks.mockRejectedValueOnce(new Error("db"));
    tg.send.mockResolvedValueOnce({ ok: true });
    await processOutgoing();
    expect(tg.send).toHaveBeenCalledWith("555", expect.objectContaining({ actions: [{ label: "Открыть", url: "/admin/gazebos" }] }));
  });
});

describe("deliverOne — failure codes and bot signals (AC-D2.3, AC-E1.4)", () => {
  it("BOT_BLOCKED marks the chain failed with the code and records the block", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([outgoing()] as never);
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValueOnce(null);
    tg.send.mockResolvedValueOnce({ ok: false, reason: "Forbidden: bot was blocked by the user", retryable: false, code: "BOT_BLOCKED" });

    await processOutgoing();
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", failureCode: "BOT_BLOCKED" }),
    }));
    expect(mockBlocked).toHaveBeenCalledWith("555");
    expect(mockProof).not.toHaveBeenCalled();
  });

  it("missing code defaults to OTHER; fallback row keeps the chain root", async () => {
    vi.mocked(prisma.outgoingNotification.findMany).mockResolvedValueOnce([outgoing({ fallbackOfId: "root-1" })] as never);
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValueOnce({ id: "ch-vk", kind: "VK" } as never);
    tg.send.mockResolvedValueOnce({ ok: false, reason: "weird", retryable: false });

    await processOutgoing();
    expect(prisma.outgoingNotification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failureCode: "OTHER" }),
    }));
    expect(prisma.outgoingNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fallbackOfId: "root-1" }),
    }));
    expect(mockEnsureLinks).toHaveBeenCalledWith(expect.objectContaining({ fallbackOfId: "root-1" }), expect.anything());
  });
});

describe("dispatch — skips (AC-D4.3)", () => {
  const event = { userId: "u-1", eventType: "booking.created", entityType: "Booking", entityId: "b-1", payload: { title: "t", body: "b" } };

  it("records the reason for duplicate / disabled / no channel", async () => {
    mockIsDuplicate.mockResolvedValueOnce(true);
    expect(await dispatch(event)).toEqual({ status: "skipped", reason: "duplicate" });
    expect(mockRecordSkip).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "DUPLICATE", userId: "u-1", entityId: "b-1" }));

    mockIsDuplicate.mockResolvedValue(false);
    vi.mocked(prisma.notificationEventPreference.findUnique).mockResolvedValueOnce({ enabled: false } as never);
    await dispatch(event);
    expect(mockRecordSkip).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "PREFERENCE_DISABLED" }));

    vi.mocked(prisma.notificationEventPreference.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValueOnce([]);
    await dispatch(event);
    expect(mockRecordSkip).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "NO_CHANNEL" }));
  });
});
