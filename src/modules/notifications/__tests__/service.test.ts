import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
    notificationLog: { create: vi.fn() },
  },
}));

vi.mock("../recipients", () => ({
  getRecipientUserIds: vi.fn(),
  getExplicitRecipientUserIds: vi.fn(),
}));

vi.mock("../channels/telegram", () => ({
  telegramAdapter: {
    channel: "TELEGRAM",
    send: vi.fn(),
    resolveRecipient: vi.fn(),
  },
}));

vi.mock("../dispatch/dispatcher", () => ({
  dispatch: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getExplicitRecipientUserIds } from "../recipients";
import { telegramAdapter } from "../channels/telegram";
import { notify } from "../service";
import type { NotificationEvent } from "../types";

const cancelledEvent: NotificationEvent = {
  type: "booking.cancelled",
  moduleSlug: "gazebos",
  entityId: "b1",
  actor: "admin",
  data: {
    resourceName: "Беседка №1",
    date: "2026-07-01",
    startTime: "10:00",
    endTime: "14:00",
    userName: "Иванов",
  },
};

function mockGazebosConfig(config: Record<string, unknown> | null) {
  vi.mocked(prisma.module.findUnique).mockImplementation(((
    { where }: { where: { slug: string } }
  ) => {
    if (where.slug === "gazebos") {
      return Promise.resolve(config === null ? null : { config });
    }
    // "system" global fallback lookup — no global chat configured by default.
    return Promise.resolve({ config: {} });
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
  vi.mocked(getExplicitRecipientUserIds).mockResolvedValue([]);
  vi.mocked(telegramAdapter.send).mockResolvedValue({ success: true });
  vi.mocked(prisma.notificationLog.create).mockResolvedValue({} as never);
});

describe("notifyAdmin — telegramAdminChatEnabled kill switch", () => {
  it("sends to the group chat when enabled (default, unset)", async () => {
    mockGazebosConfig({ telegramAdminChatId: "-100111" });

    await notify(cancelledEvent);

    expect(telegramAdapter.send).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.send).toHaveBeenCalledWith(
      "-100111",
      expect.any(String),
      expect.anything()
    );
  });

  it("skips the group chat entirely when explicitly disabled, with no fallback", async () => {
    mockGazebosConfig({
      telegramAdminChatId: "-100111",
      telegramAdminChatEnabled: false,
    });

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("does not fall back to the global admin chat when disabled", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100global");
    mockGazebosConfig({ telegramAdminChatEnabled: false });

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
  });

  it("still delivers to explicit per-user recipients when the group chat is disabled", async () => {
    mockGazebosConfig({
      telegramAdminChatId: "-100111",
      telegramAdminChatEnabled: false,
    });
    vi.mocked(getExplicitRecipientUserIds).mockResolvedValue(["user-1"]);
    const { dispatch } = await import("../dispatch/dispatcher");

    await notify(cancelledEvent);

    expect(telegramAdapter.send).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" })
    );
  });
});
