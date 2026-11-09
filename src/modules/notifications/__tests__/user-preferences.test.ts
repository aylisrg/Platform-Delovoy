import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
    notificationEventPreference: { findUnique: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getUserPreferences, updateUserPreferences } from "../service";
import { WEEKLY_DIGEST_EVENT } from "../weekly-digest";
import { webappPreferenceSchema } from "../validation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: null, phone: null, telegramId: "1", vkId: null } as never);
  vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.notificationEventPreference.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.notificationPreference.upsert).mockResolvedValue({
    enableBooking: true, enableOrder: true, enableReminder: true, preferredChannel: "AUTO",
  } as never);
});

describe("подсказки недели в личных настройках", () => {
  it("по умолчанию включены, явная отписка читается из строки события", async () => {
    expect((await getUserPreferences("u1")).preferences.enableWeeklyTips).toBe(true);
    vi.mocked(prisma.notificationEventPreference.findUnique).mockResolvedValue({ enabled: false } as never);
    expect((await getUserPreferences("u1")).preferences.enableWeeklyTips).toBe(false);
    expect(prisma.notificationEventPreference.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_eventType: { userId: "u1", eventType: WEEKLY_DIGEST_EVENT } },
    }));
  });

  it("отписка пишет свою строку и не попадает в колонки NotificationPreference", async () => {
    const result = await updateUserPreferences("u1", { enableWeeklyTips: false, enableOrder: false });
    expect(prisma.notificationEventPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_eventType: { userId: "u1", eventType: WEEKLY_DIGEST_EVENT } },
      update: expect.objectContaining({ enabled: false, updatedVia: "miniapp" }),
    }));
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" }, create: { userId: "u1", enableOrder: false }, update: { enableOrder: false },
    });
    expect(result.enableWeeklyTips).toBe(false);
  });

  it("без поля строку события не трогает", async () => {
    await updateUserPreferences("u1", { enableBooking: false });
    expect(prisma.notificationEventPreference.upsert).not.toHaveBeenCalled();
  });

  it("схема Mini App принимает только boolean", () => {
    expect(webappPreferenceSchema.safeParse({ enableWeeklyTips: false }).success).toBe(true);
    expect(webappPreferenceSchema.safeParse({ enableWeeklyTips: "no" }).success).toBe(false);
  });
});
