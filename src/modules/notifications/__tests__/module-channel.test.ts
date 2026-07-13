import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { dispatchModuleChannel } from "../module-channel";
import type { NotificationEvent } from "../types";

const paidEvent: NotificationEvent = {
  type: "booking.paid",
  moduleSlug: "gazebos",
  entityId: "b1",
  actor: "admin",
  data: {
    resourceName: "Беседка №1",
    date: "2026-07-01",
    startTime: "10:00",
    endTime: "14:00",
    clientName: "Иванов",
    amount: "1 500,00",
    bookingId: "b1",
  },
};

function mockConfig(config: Record<string, unknown> | null) {
  vi.mocked(prisma.module.findUnique).mockResolvedValueOnce(
    config === null ? null : ({ config } as never)
  );
}

function sentBody() {
  return JSON.parse(
    (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://delovoy-park.ru");
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dispatchModuleChannel", () => {
  it("постит booking.paid (gazebos) один раз со ссылкой на бронь", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-1001234567890",
      telegramChannelEvents: ["booking.paid", "booking.cancelled"],
    });

    await dispatchModuleChannel(paidEvent);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/bottest-token/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("Беседка №1");
    expect(body.text).toContain("оплачена");
    // Ссылка «Открыть в панели» на конкретную бронь беседки.
    expect(body.text).toContain(
      '<a href="https://delovoy-park.ru/admin/gazebos/bookings/b1">'
    );
    expect(body.text).toContain("http");
  });

  it("постит booking.paid (ps-park) со ссылкой на сессию", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid"],
    });

    await dispatchModuleChannel({
      ...paidEvent,
      moduleSlug: "ps-park",
      data: { ...paidEvent.data, resourceName: "Стол 1" },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().text).toContain(
      '<a href="https://delovoy-park.ru/admin/ps-park/sessions/b1">'
    );
  });

  it("booking.created больше НЕ постится в канал (шаблон удалён)", async () => {
    // Даже если старый сохранённый конфиг всё ещё содержит booking.created.
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.created", "booking.paid"],
    });

    await dispatchModuleChannel({ ...paidEvent, type: "booking.created" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("booking.confirmed больше НЕ постится (нет двойного поста с booking.paid)", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.confirmed", "booking.paid"],
    });

    await dispatchModuleChannel({ ...paidEvent, type: "booking.confirmed" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("экранирует HTML в названии ресурса и имени клиента", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid"],
    });

    await dispatchModuleChannel({
      ...paidEvent,
      data: { ...paidEvent.data, resourceName: "<b>x</b>", clientName: "A & B" },
    });
    const text = sentBody().text as string;
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(text).toContain("A &amp; B");
  });

  it("skips when the channel is disabled", async () => {
    mockConfig({
      telegramChannelEnabled: false,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid"],
    });

    await dispatchModuleChannel(paidEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips when the event type is not in the enabled list", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.cancelled"],
    });

    await dispatchModuleChannel(paidEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips when chatId is empty", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "   ",
      telegramChannelEvents: ["booking.paid"],
    });

    await dispatchModuleChannel(paidEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips when there is no config at all", async () => {
    mockConfig(null);
    await dispatchModuleChannel(paidEvent);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses the per-module bot token override when present", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid"],
      telegramBotToken: "override-token",
    });

    await dispatchModuleChannel(paidEvent);
    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/botoverride-token/sendMessage");
  });

  it("never throws when fetch rejects", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.paid"],
    });
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as never;

    await expect(dispatchModuleChannel(paidEvent)).resolves.toBeUndefined();
  });

  it("sends a template for the booking.deleted event (gazebos)", async () => {
    mockConfig({
      telegramChannelEnabled: true,
      telegramChannelId: "-100",
      telegramChannelEvents: ["booking.deleted"],
    });

    await dispatchModuleChannel({ ...paidEvent, type: "booking.deleted" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().text).toContain("удалена");
  });
});
