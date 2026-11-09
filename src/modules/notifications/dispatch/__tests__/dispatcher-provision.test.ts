import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    outgoingNotification: { findFirst: vi.fn(), create: vi.fn() },
    userNotificationChannel: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    notificationGlobalPreference: { findUnique: vi.fn() },
    notificationEventPreference: { findUnique: vi.fn() },
    notificationDeliverySkip: { create: vi.fn() },
    systemEvent: { create: vi.fn() },
  },
}));
vi.mock("../channels", () => ({ bootstrapChannels: vi.fn() }));
vi.mock("../dedup", () => ({ computeDedupKey: () => "k", isDuplicate: vi.fn().mockResolvedValue(false) }));
vi.mock("../../skips", () => ({ recordSkip: vi.fn() }));

import { prisma } from "@/lib/db";
import { dispatch, provisionStaffTelegramChannel } from "../dispatcher";
import { ChannelRegistry } from "../channel-registry";

const channelRow = { id: "ch-1", userId: "u1", kind: "TELEGRAM", address: "555", priority: 10, isActive: true, verifiedAt: new Date() };
const event = { userId: "u1", eventType: "booking.created", entityId: "b1", payload: { title: "T", body: "B" } };

beforeEach(() => {
  vi.clearAllMocks();
  ChannelRegistry.reset();
  ChannelRegistry.register({ kind: "TELEGRAM", isAvailable: () => true, send: vi.fn() } as never);
  vi.mocked(prisma.notificationGlobalPreference.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.notificationEventPreference.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.userNotificationChannel.findMany).mockResolvedValue([]);
  vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.userNotificationChannel.create).mockResolvedValue(channelRow as never);
  vi.mocked(prisma.outgoingNotification.create).mockResolvedValue({ id: "o1" } as never);
});

describe("dispatch — канал Telegram заводится сотруднику автоматически", () => {
  it("сотрудник с привязанным Telegram, но без строки канала — канал создаётся, сообщение в очереди", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN", telegramId: "555", mergedIntoUserId: null } as never);

    const outcome = await dispatch(event);

    expect(outcome.status).toBe("queued");
    expect(prisma.userNotificationChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", kind: "TELEGRAM", address: "555", isActive: true, verifiedAt: expect.any(Date) }),
    });
    expect(prisma.outgoingNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ channelId: "ch-1" }) });
  });

  it("гостю (USER) канал не заводится — рассылки идут только по верифицированным каналам", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "USER", telegramId: "555", mergedIntoUserId: null } as never);
    expect((await dispatch(event)).status).toBe("skipped");
    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
  });

  it("выключенный человеком канал не реактивируется", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN", telegramId: "555", mergedIntoUserId: null } as never);
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValue({ ...channelRow, isActive: false } as never);
    expect((await dispatch(event)).status).toBe("skipped");
    expect(prisma.userNotificationChannel.create).not.toHaveBeenCalled();
    expect(prisma.userNotificationChannel.update).not.toHaveBeenCalled();
  });

  it("без telegramId, влитый аккаунт или ошибка БД — как раньше, без канала", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN", telegramId: null, mergedIntoUserId: null } as never);
    expect(await provisionStaffTelegramChannel("u1")).toBeNull();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN", telegramId: "555", mergedIntoUserId: "p" } as never);
    expect(await provisionStaffTelegramChannel("u1")).toBeNull();
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("db down"));
    expect(await provisionStaffTelegramChannel("u1")).toBeNull();
  });

  it("активный, но не верифицированный канал своего же Telegram — верифицируется", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "SUPERADMIN", telegramId: "555", mergedIntoUserId: null } as never);
    vi.mocked(prisma.userNotificationChannel.findFirst).mockResolvedValue({ ...channelRow, verifiedAt: null } as never);
    vi.mocked(prisma.userNotificationChannel.update).mockResolvedValue(channelRow as never);
    expect(await provisionStaffTelegramChannel("u1")).toEqual(channelRow);
  });
});
