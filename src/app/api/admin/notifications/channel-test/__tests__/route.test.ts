import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Auth: always an authenticated superadmin.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => ({ user: { id: "admin-1", role: "SUPERADMIN", name: "Admin" } })),
}));

// Keep real apiResponse/apiError helpers; bypass the section gate.
vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual("@/lib/api-response");
  return { ...actual, requireAdminSection: vi.fn(() => null) };
});

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn(),
}));

const mockTelegramApi = vi.fn();
vi.mock("@/lib/telegram/client", () => ({
  telegramApi: (...args: unknown[]) => mockTelegramApi(...args),
}));

import { GET, POST, PATCH } from "../route";

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/notifications/channel-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/notifications/channel-test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
  mockFindMany.mockReset();
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockTelegramApi.mockReset();
  mockTelegramApi.mockResolvedValue({ ok: true, result: { chat: { title: "Тест-чат" } } });
});

describe("GET /api/admin/notifications/channel-test", () => {
  it("returns status for both dedicated module channels", async () => {
    mockFindMany.mockResolvedValue([
      {
        slug: "gazebos",
        config: {
          telegramChannelEnabled: true,
          telegramChannelId: "-100777",
          telegramChannelName: "Беседки Live",
          telegramBotToken: "gaz-bot",
          telegramChannelEvents: ["booking.paid", "booking.cancelled"],
        },
      },
      // ps-park intentionally absent → not configured
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.moduleChannels).toHaveLength(2);

    const gazebos = body.data.moduleChannels.find(
      (c: { slug: string }) => c.slug === "gazebos"
    );
    expect(gazebos).toMatchObject({
      slug: "gazebos",
      label: "Барбекю Парк",
      enabled: true,
      configured: true,
      chatId: "-100777",
      channelName: "Беседки Live",
      usesOwnBot: true,
    });
    expect(gazebos.events).toEqual(
      expect.arrayContaining([
        { type: "booking.paid", label: "Оплачено онлайн", enabled: true },
        { type: "booking.cancelled", label: "Бронь отменена", enabled: true },
        { type: "booking.completed", label: "Бронь завершена", enabled: false },
      ])
    );

    const psPark = body.data.moduleChannels.find(
      (c: { slug: string }) => c.slug === "ps-park"
    );
    expect(psPark).toMatchObject({
      slug: "ps-park",
      label: "Плей Парк",
      enabled: false,
      configured: false,
      chatId: null,
      usesOwnBot: false,
    });
    expect(psPark.events.every((e: { enabled: boolean }) => e.enabled === false)).toBe(
      true
    );
  });
});

describe("PATCH /api/admin/notifications/channel-test", () => {
  it("disables the module channel without touching the chat ID", async () => {
    mockFindUnique.mockResolvedValue({
      id: "mod-1",
      config: { telegramChannelEnabled: true, telegramChannelId: "-100777" },
    });
    mockUpdate.mockResolvedValue({});

    const res = await PATCH(
      patchReq({ slug: "gazebos", telegramChannelEnabled: false })
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { slug: "gazebos" },
      data: {
        config: { telegramChannelEnabled: false, telegramChannelId: "-100777" },
      },
    });
  });

  it("updates the enabled event list", async () => {
    mockFindUnique.mockResolvedValue({
      id: "mod-1",
      config: { telegramChannelEnabled: true, telegramChannelId: "-100777" },
    });
    mockUpdate.mockResolvedValue({});

    const res = await PATCH(
      patchReq({
        slug: "gazebos",
        telegramChannelEvents: ["booking.paid", "booking.deleted"],
      })
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.events).toEqual(["booking.paid", "booking.deleted"]);
  });

  it("rejects an event type that doesn't exist for the module", async () => {
    const res = await PATCH(
      patchReq({ slug: "ps-park", telegramChannelEvents: ["booking.deleted"] })
    );
    const body = await res.json();

    // booking.deleted is a gazebos-only event, not valid for ps-park.
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown module slug", async () => {
    const res = await PATCH(patchReq({ slug: "cafe", telegramChannelEnabled: true }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND when the module record doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await PATCH(patchReq({ slug: "gazebos", telegramChannelEnabled: true }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /api/admin/notifications/channel-test — routing", () => {
  it("sends the unified test message to a category's own chat", async () => {
    mockFindUnique.mockResolvedValueOnce({ config: { telegramAdminChatId: "-100111" } });

    const res = await POST(postReq({ kind: "routing", key: "cafe" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.chatId).toBe("-100111");
    expect(body.data.channelName).toBe("Кафе");

    expect(mockTelegramApi).toHaveBeenCalledTimes(1);
    const [method, payload, options] = mockTelegramApi.mock.calls[0];
    expect(method).toBe("sendMessage");
    expect(payload.chat_id).toBe("-100111");
    expect(payload.parse_mode).toBe("HTML");
    expect(payload.text).toContain("«<b>Кафе</b>»");
    expect(payload.text).toContain("Это тестовое сообщение");
    expect(payload.text).toContain("Всё работает штатно");
    expect(options.botToken).toBe("test-token");
  });

  it("resolves the correct label for rental-inquiry (the previously dropped key)", async () => {
    mockFindUnique.mockResolvedValueOnce({ config: { telegramAdminChatId: "-100222" } });

    const res = await POST(postReq({ kind: "routing", key: "rental-inquiry" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.channelName).toBe("Заявки на офис (лендинг)");
    const [, payload] = mockTelegramApi.mock.calls[0];
    expect(payload.text).toContain("«<b>Заявки на офис (лендинг)</b>»");
  });

  it("falls back to the global env chat when neither module nor system has one", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100env");
    mockFindUnique
      .mockResolvedValueOnce({ config: {} }) // category "cafe"
      .mockResolvedValueOnce({ config: {} }); // "system"

    const res = await POST(postReq({ kind: "routing", key: "cafe" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.chatId).toBe("-100env");
  });

  it("returns NO_CHAT_ID when no chat is configured anywhere", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ config: {} }) // category
      .mockResolvedValueOnce({ config: {} }); // system

    const res = await POST(postReq({ kind: "routing", key: "cafe" }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NO_CHAT_ID");
    expect(mockTelegramApi).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/notifications/channel-test — module-channel", () => {
  it("sends via the module's own bot token and saved channel name", async () => {
    mockFindUnique.mockResolvedValueOnce({
      config: {
        telegramChannelEnabled: true,
        telegramChannelId: "-100888",
        telegramChannelName: "Беседки Live",
        telegramBotToken: "gaz-bot",
      },
    });

    const res = await POST(postReq({ kind: "module-channel", slug: "gazebos" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.chatId).toBe("-100888");
    const [, payload, options] = mockTelegramApi.mock.calls[0];
    expect(payload.chat_id).toBe("-100888");
    expect(payload.text).toContain("«<b>Беседки Live</b>»");
    expect(options.botToken).toBe("gaz-bot");
  });

  it("uses the env bot token and label fallback when the module has no override", async () => {
    mockFindUnique.mockResolvedValueOnce({
      config: { telegramChannelId: "-100999", telegramChannelEnabled: true },
    });

    const res = await POST(postReq({ kind: "module-channel", slug: "ps-park" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    const [, payload, options] = mockTelegramApi.mock.calls[0];
    expect(options.botToken).toBe("test-token");
    expect(payload.text).toContain("«<b>Плей Парк (канал модуля)</b>»");
  });

  it("returns NO_CHAT_ID when the module channel has no chat id", async () => {
    mockFindUnique.mockResolvedValueOnce({ config: {} });

    const res = await POST(postReq({ kind: "module-channel", slug: "gazebos" }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NO_CHAT_ID");
    expect(mockTelegramApi).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/notifications/channel-test — errors", () => {
  it("rejects an invalid body with a validation error", async () => {
    const res = await POST(postReq({ kind: "bogus" }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockTelegramApi).not.toHaveBeenCalled();
  });

  it("returns BOT_NOT_CONFIGURED when the bot token is missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");

    const res = await POST(postReq({ kind: "routing", key: "cafe" }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("BOT_NOT_CONFIGURED");
  });

  it("maps a Telegram transport error to 502 TELEGRAM_UNREACHABLE", async () => {
    mockFindUnique.mockResolvedValueOnce({ config: { telegramAdminChatId: "-100111" } });
    mockTelegramApi.mockResolvedValue({
      ok: false,
      transportError: true,
      description: "Timeout",
      retryable: true,
    });

    const res = await POST(postReq({ kind: "routing", key: "cafe" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error.code).toBe("TELEGRAM_UNREACHABLE");
  });

  it("surfaces a Telegram API error", async () => {
    mockFindUnique.mockResolvedValueOnce({ config: { telegramAdminChatId: "-100111" } });
    mockTelegramApi.mockResolvedValue({
      ok: false,
      transportError: false,
      description: "chat not found",
      retryable: false,
    });

    const res = await POST(postReq({ kind: "routing", key: "cafe" }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("TELEGRAM_ERROR");
    expect(body.error.message).toContain("chat not found");
  });
});
