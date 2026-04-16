import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
    notificationPreference: {
      upsert: vi.fn(),
    },
  },
}));

// Mock Telegram adapter
vi.mock("../channels/telegram", () => ({
  telegramAdapter: {
    send: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { telegramAdapter } from "../channels/telegram";
import {
  sendReleaseNotification,
  setReleaseNotifyPreference,
  getReleaseSubscribers,
} from "../release-notify";

const mockFindMany = vi.mocked(prisma.user.findMany);
const mockUpsert = vi.mocked(prisma.notificationPreference.upsert);
const mockTelegramSend = vi.mocked(telegramAdapter.send);

beforeEach(() => {
  vi.clearAllMocks();
});

const baseRelease = {
  version: "1.2.0",
  releaseNotes: "- New feature A\n- Fixed bug B",
  commitSha: "abc1234567890",
  deployedAt: "2026-04-16T10:00:00.000Z",
};

describe("sendReleaseNotification", () => {
  it("returns zeros when no subscribers", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await sendReleaseNotification(baseRelease);

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mockTelegramSend).not.toHaveBeenCalled();
  });

  it("sends to all subscribers with telegramId", async () => {
    mockFindMany.mockResolvedValue([
      { id: "u1", telegramId: "111" },
      { id: "u2", telegramId: "222" },
    ] as never);
    mockTelegramSend.mockResolvedValue({ success: true });

    const result = await sendReleaseNotification(baseRelease);

    expect(mockTelegramSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
  });

  it("counts failed sends without throwing", async () => {
    mockFindMany.mockResolvedValue([
      { id: "u1", telegramId: "111" },
      { id: "u2", telegramId: "222" },
    ] as never);
    mockTelegramSend
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "Bot blocked by user" });

    const result = await sendReleaseNotification(baseRelease);

    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
  });

  it("message contains version, short SHA, and notes", async () => {
    mockFindMany.mockResolvedValue([
      { id: "u1", telegramId: "999" },
    ] as never);
    mockTelegramSend.mockResolvedValue({ success: true });

    await sendReleaseNotification(baseRelease);

    const sentMessage = mockTelegramSend.mock.calls[0][1] as string;
    expect(sentMessage).toContain("v1.2.0");
    expect(sentMessage).toContain("abc1234"); // short sha
    expect(sentMessage).toContain("New feature A");
  });

  it("message omits notes section when releaseNotes is empty", async () => {
    mockFindMany.mockResolvedValue([
      { id: "u1", telegramId: "999" },
    ] as never);
    mockTelegramSend.mockResolvedValue({ success: true });

    await sendReleaseNotification({ ...baseRelease, releaseNotes: "" });

    const sentMessage = mockTelegramSend.mock.calls[0][1] as string;
    expect(sentMessage).not.toContain("Что выкатилось");
  });

  it("queries only SUPERADMIN/MANAGER users with notifyReleases=true", async () => {
    mockFindMany.mockResolvedValue([]);

    await sendReleaseNotification(baseRelease);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ["SUPERADMIN", "MANAGER"] },
          notificationPreference: { notifyReleases: true },
        }),
      })
    );
  });
});

describe("setReleaseNotifyPreference", () => {
  it("upserts preference with enabled=true", async () => {
    mockUpsert.mockResolvedValue({} as never);

    await setReleaseNotifyPreference("user-1", true);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", notifyReleases: true },
      update: { notifyReleases: true },
    });
  });

  it("upserts preference with enabled=false", async () => {
    mockUpsert.mockResolvedValue({} as never);

    await setReleaseNotifyPreference("user-1", false);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { notifyReleases: false },
      })
    );
  });
});

describe("getReleaseSubscribers", () => {
  it("returns notifyReleases=false when no preference exists", async () => {
    mockFindMany.mockResolvedValue([
      { id: "u1", notificationPreference: null },
    ] as never);

    const result = await getReleaseSubscribers();

    expect(result).toEqual([{ id: "u1", notifyReleases: false }]);
  });

  it("returns actual preference value when preference exists", async () => {
    mockFindMany.mockResolvedValue([
      { id: "u1", notificationPreference: { notifyReleases: true } },
      { id: "u2", notificationPreference: { notifyReleases: false } },
    ] as never);

    const result = await getReleaseSubscribers();

    expect(result).toEqual([
      { id: "u1", notifyReleases: true },
      { id: "u2", notifyReleases: false },
    ]);
  });
});
