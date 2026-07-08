import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { dispatchModuleChannel } from "../module-channel";
import type { NotificationEvent } from "../types";

const baseEvent: NotificationEvent = {
  type: "booking.created",
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

function mockConfig(config: Record<string, unknown> | null) {
  vi.mocked(prisma.module.findUnique).mockResolvedValueOnce(
    config === null ? null : ({ config } as never)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dispatchModuleChannel", () => {
  it("sends to Telegram when enabled, event toggled on, and chatId present", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-1001234567890",
      telegramChannelEvents: ["booking.created", "booking.cancelled"],
    });

    await dispatchModuleChannel(baseEvent);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/bottest-token/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("Беседка №1");
  });

  it("skips when the channel is disabled", async () => {
    mockConfig({
      telegramChannelEnabled: false,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.created"],
    });

    await dispatchModuleChannel(baseEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips when the event type is not in the enabled list", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.cancelled"],
    });

    await dispatchModuleChannel(baseEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips when chatId is empty", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "   ",
      telegramChannelEvents: ["booking.created"],
    });

    await dispatchModuleChannel(baseEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips when there is no config at all", async () => {
    mockConfig(null);
    await dispatchModuleChannel(baseEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses the per-module bot token override when present", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.created"],
      telegramBotToken: "override-token",
    });

    await dispatchModuleChannel(baseEvent);
    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/botoverride-token/sendMessage");
  });

  it("never throws when fetch rejects", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.created"],
    });
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as never;

    await expect(dispatchModuleChannel(baseEvent)).resolves.toBeUndefined();
  });

  it("sends a template for the booking.updated event", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.updated"],
    });

    await dispatchModuleChannel({
      ...baseEvent,
      type: "booking.updated",
      data: { ...baseEvent.data, changes: "время" },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.text).toContain("изменена");
  });

  it("sends a template for the new booking.deleted event", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.deleted"],
    });

    await dispatchModuleChannel({ ...baseEvent, type: "booking.deleted" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.text).toContain("удалена");
  });
});
