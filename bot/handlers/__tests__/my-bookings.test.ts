import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBotFetch = vi.fn();
vi.mock("../../lib/api", () => ({
  botFetch: (...args: unknown[]) => mockBotFetch(...args),
  API_URL: "http://test",
}));

import { performCancel, showBookings } from "../my-bookings";

type MockCtx = {
  editMessageText: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  from?: { id: number };
};

function makeCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    from: { id: 12345 },
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// #427: cancel-booking отдавал penaltyRequired как success:true — бот показывал
// "✅ отменено" на брони, которая на самом деле осталась активной.
describe("performCancel", () => {
  it("shows success on a real cancellation", async () => {
    mockBotFetch.mockResolvedValue(jsonResponse({ success: true, data: { id: "bk-1", status: "CANCELLED" } }));

    const ctx = makeCtx();
    await performCancel(ctx as never, "bk-1", false);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "✅ Бронирование отменено.",
      expect.anything()
    );
  });

  it("sends confirmPenalty in the request body", async () => {
    mockBotFetch.mockResolvedValue(jsonResponse({ success: true, data: { id: "bk-1", status: "CANCELLED" } }));

    const ctx = makeCtx();
    await performCancel(ctx as never, "bk-1", true);

    expect(mockBotFetch).toHaveBeenCalledWith(
      "/api/bot/cancel-booking",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ telegramId: "12345", bookingId: "bk-1", confirmPenalty: true }),
      })
    );
  });

  it("does NOT show a false success on PENALTY_CONFIRMATION_REQUIRED — offers a penalty-confirm button instead", async () => {
    mockBotFetch.mockResolvedValue(
      jsonResponse({
        success: false,
        error: {
          code: "PENALTY_CONFIRMATION_REQUIRED",
          message: "Отмена позже допустимого срока требует подтверждения штрафа",
          metadata: { penaltyAmount: 500, basePrice: 1000 },
        },
      })
    );

    const ctx = makeCtx();
    await performCancel(ctx as never, "bk-1", false);

    const [text, opts] = ctx.editMessageText.mock.calls[0];
    expect(text).not.toContain("✅ Бронирование отменено");
    expect(text).toContain("500");

    const keyboard = opts.reply_markup.inline_keyboard as Array<Array<{ text: string; callback_data?: string }>>;
    const confirmButton = keyboard.flat().find((b) => b.callback_data === "mybookings_confirm_penalty:bk-1");
    expect(confirmButton).toBeTruthy();
  });

  it("shows the server error message for other failures", async () => {
    mockBotFetch.mockResolvedValue(
      jsonResponse({ success: false, error: { code: "BOOKING_NOT_FOUND", message: "Бронирование не найдено" } })
    );

    const ctx = makeCtx();
    await performCancel(ctx as never, "bk-1", false);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Бронирование не найдено"),
      expect.anything()
    );
  });

  it("shows a network-error message when the fetch throws", async () => {
    mockBotFetch.mockRejectedValue(new Error("network down"));

    const ctx = makeCtx();
    await performCancel(ctx as never, "bk-1", false);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "Ошибка сети. Попробуйте позже.",
      expect.anything()
    );
  });

  it("shows an auth error when ctx.from is missing, without calling the API", async () => {
    const ctx = makeCtx({ from: undefined });
    await performCancel(ctx as never, "bk-1", false);

    expect(mockBotFetch).not.toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith("Ошибка авторизации.");
  });
});

// #534: resourceName — админский ввод (название беседки/стола), уходит с
// parse_mode:"HTML".
describe("showBookings — экранирование resourceName", () => {
  it("экранирует resourceName перед подстановкой в HTML-сообщение", async () => {
    mockBotFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            id: "bk-1",
            moduleSlug: "gazebos",
            resourceName: "<b>Беседка</b> <script>alert(1)</script>",
            date: "2026-09-01",
            startTime: "10:00",
            endTime: "12:00",
            status: "CONFIRMED",
          },
        ],
      })
    );

    const ctx = makeCtx();
    await showBookings(ctx as never, true);

    const [text, opts] = ctx.editMessageText.mock.calls[0];
    expect(opts).toMatchObject({ parse_mode: "HTML" });
    expect(text).toContain("&lt;b&gt;Беседка&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).not.toContain("<script>alert(1)</script>");
  });
});
